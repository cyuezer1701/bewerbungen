import fs from 'node:fs';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/index.js';
import {
  getJobById, getApplicationByJobId, insertApplication, updateApplicationStatus,
  updateApplicationCoverLetter, updateApplicationPdfPaths, updateApplicationSentInfo,
  updateJobStatus, logActivity, updateApplicationFactCheck,
} from '../../db/queries.js';
import { getStructuredCV } from '../../matching/cv-parser.js';
import { generateCoverLetter, formatCoverLetterForStorage } from '../../generator/cover-letter.js';
import { calculateHumanScore, humanizeText } from '../../generator/humanizer.js';
import { verifyFacts } from '../../generator/fact-checker.js';
import { generateApplicationPackage } from '../../generator/pdf-builder.js';
import { sendApplicationEmail } from '../../mailer/index.js';
import { getActivityForJob, updateApplicationHumanScore, updateApplicationCoverLetter as updateAppCoverLetter2 } from '../../db/queries.js';
import { researchCompany } from '../../matching/company-research.js';
import { logger } from '../../utils/logger.js';
import type { ApplicationRow } from '../../db/queries.js';

export const applicationsRouter = Router();

// GET /api/applications — List
// curl -H "Authorization: Bearer TOKEN" "http://localhost:3333/api/applications?status=ready&page=1"
applicationsRouter.get('/', (req, res) => {
  const { status, page = '1', limit = '20' } = req.query;
  const db = getDb();

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (status) { where += ' AND a.status = ?'; params.push(status); }

  const offset = (Number(page) - 1) * Number(limit);
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM applications a ${where}`).get(...params) as { total: number };
  const rows = db.prepare(`SELECT a.*, j.title as job_title, j.company as job_company FROM applications a JOIN jobs j ON a.job_id = j.id ${where} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), offset);

  res.json({ data: rows, total: countRow.total, page: Number(page), limit: Number(limit) });
});

// GET /api/applications/:id — Detail
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/applications/APP_ID
applicationsRouter.get('/:id', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT a.*, j.title as job_title, j.company as job_company FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  res.json(app);
});

// POST /api/applications — Create (generates cover letter)
// curl -X POST -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"job_id":"test-job-001"}' http://localhost:3333/api/applications
applicationsRouter.post('/', async (req, res) => {
  const { job_id, feedback } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id required' });

  const job = getJobById(job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    const cv = await getStructuredCV();
    let focus = 'Allgemeine Passung hervorheben';
    const matchDetails = getActivityForJob(job.id, 'matched');
    if (matchDetails) {
      try { const d = JSON.parse(matchDetails); if (d.cover_letter_focus) focus = d.cover_letter_focus; } catch {}
    }

    const companyResearch = await researchCompany(job.company, job.location || '');
    const coverLetterData = await generateCoverLetter(job, cv, focus, companyResearch, feedback);
    const appId = uuidv4();
    insertApplication({ id: appId, job_id: job.id, cover_letter_text: formatCoverLetterForStorage(coverLetterData) });
    updateJobStatus(job.id, 'applying');

    // Save fact check results
    if (coverLetterData.factCheckPassed !== undefined) {
      updateApplicationFactCheck(appId, coverLetterData.factCheckPassed, coverLetterData.factCheckViolations || []);
    }

    // Generate PDFs
    try {
      const { pdfPath, fullPackagePath } = await generateApplicationPackage(job, coverLetterData);
      updateApplicationPdfPaths(appId, pdfPath, fullPackagePath);
    } catch (err) {
      logger.error('PDF generation failed in API', { error: err });
    }

    logActivity(job.id, appId, 'generated', JSON.stringify({ version: 1, via: 'api' }));
    res.json(getApplicationByJobId(job.id));
  } catch (err) {
    logger.error('Application creation failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// PATCH /api/applications/:id — Update
// curl -X PATCH -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"status":"ready"}' http://localhost:3333/api/applications/APP_ID
applicationsRouter.patch('/:id', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as ApplicationRow | undefined;
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const { status, cover_letter_text } = req.body;
  if (status) updateApplicationStatus(req.params.id, status);
  if (cover_letter_text) updateApplicationCoverLetter(req.params.id, cover_letter_text, app.version + 1);

  res.json(db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id));
});

// POST /api/applications/:id/regenerate — Regenerate with feedback
// curl -X POST -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"feedback":"Mehr Teamfuehrung betonen"}' http://localhost:3333/api/applications/APP_ID/regenerate
applicationsRouter.post('/:id/regenerate', async (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as ApplicationRow | undefined;
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const job = getJobById(app.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    const cv = await getStructuredCV();
    let focus = 'Allgemeine Passung hervorheben';
    const matchDetails = getActivityForJob(job.id, 'matched');
    if (matchDetails) { try { const d = JSON.parse(matchDetails); if (d.cover_letter_focus) focus = d.cover_letter_focus; } catch {} }

    const companyResearch = await researchCompany(job.company, job.location || '');
    const coverLetterData = await generateCoverLetter(job, cv, focus, companyResearch, req.body.feedback);
    const newVersion = app.version + 1;
    updateApplicationCoverLetter(app.id, formatCoverLetterForStorage(coverLetterData), newVersion);

    try {
      const { pdfPath, fullPackagePath } = await generateApplicationPackage(job, coverLetterData);
      updateApplicationPdfPaths(app.id, pdfPath, fullPackagePath);
    } catch (err) { logger.error('PDF regen failed', { error: err }); }

    logActivity(job.id, app.id, 'edited', JSON.stringify({ version: newVersion, via: 'api' }));
    res.json(db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Regeneration failed' });
  }
});

// POST /api/applications/:id/send-email — Send via email
// curl -X POST -H "Authorization: Bearer TOKEN" http://localhost:3333/api/applications/APP_ID/send-email
applicationsRouter.post('/:id/send-email', async (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as ApplicationRow | undefined;
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const job = getJobById(app.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.application_email) return res.status(400).json({ error: 'No email address for this job' });

  try {
    await sendApplicationEmail(job, app, job.application_email);
    updateApplicationSentInfo(app.id, 'email', job.application_email);
    updateJobStatus(job.id, 'applied');
    logActivity(job.id, app.id, 'sent', JSON.stringify({ sent_via: 'email', sent_to: job.application_email, via: 'api' }));
    res.json({ ok: true, sent_to: job.application_email });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Send failed' });
  }
});

// POST /api/applications/:id/mark-sent — Mark as sent via portal
// curl -X POST -H "Authorization: Bearer TOKEN" http://localhost:3333/api/applications/APP_ID/mark-sent
applicationsRouter.post('/:id/mark-sent', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as ApplicationRow | undefined;
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const job = getJobById(app.job_id);
  updateApplicationSentInfo(app.id, 'portal', job?.application_url || 'portal');
  if (job) updateJobStatus(job.id, 'applied');
  logActivity(app.job_id, app.id, 'sent', JSON.stringify({ sent_via: 'portal', via: 'api' }));
  res.json({ ok: true });
});

// POST /api/applications/:id/humanize — Humanize cover letter (Phase 14)
applicationsRouter.post('/:id/humanize', async (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as ApplicationRow | undefined;
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (!app.cover_letter_text) return res.status(400).json({ error: 'No cover letter text' });

  try {
    // Parse cover letter text back to content (best effort)
    const lines = app.cover_letter_text.split('\n').filter((l: string) => l.trim().length > 0);
    const paragraphs = lines.filter((l: string) => !l.startsWith('Sehr geehrte') && l !== 'Freundliche Grüsse' && l !== 'Freundliche Gruesse' && !lines.includes(l) || true);

    // Extract the 4 body paragraphs (skip anrede and closing)
    const bodyLines: string[] = [];
    let started = false;
    for (const line of lines) {
      if (line.startsWith('Sehr geehrte') || line.startsWith('Sehr geehrter')) { started = true; continue; }
      if (line === 'Freundliche Grüsse' || line === 'Freundliche Gruesse') break;
      if (started) bodyLines.push(line);
    }

    const content = {
      betreff: '',
      anrede: lines.find((l: string) => l.startsWith('Sehr geehrte')) || '',
      absatz_1: bodyLines[0] || '',
      absatz_2: bodyLines[1] || '',
      absatz_3: bodyLines[2] || '',
      absatz_4: bodyLines[3] || '',
    };

    const { content: humanized, report } = await humanizeText(content);
    const newText = [humanized.anrede || content.anrede, '', humanized.absatz_1, '', humanized.absatz_2, '', humanized.absatz_3, '', humanized.absatz_4, '', 'Freundliche Grüsse'].join('\n');
    updateAppCoverLetter2(app.id, newText, app.version + 1);
    updateApplicationHumanScore(app.id, report.score);
    res.json({ report, version: app.version + 1 });
  } catch (err) {
    logger.error('Humanize failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Humanize failed' });
  }
});

// GET /api/applications/:id/human-score — Get human score + flags (Phase 14)
applicationsRouter.get('/:id/human-score', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as ApplicationRow | undefined;
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (!app.cover_letter_text) return res.status(400).json({ error: 'No cover letter text' });

  const { score, details, flaggedPatterns } = calculateHumanScore(app.cover_letter_text);
  const extended = app as ApplicationRow & { human_score?: number; fact_check_passed?: number; fact_check_violations?: string };
  let factCheckViolations: string[] = [];
  if (extended.fact_check_violations) {
    try { factCheckViolations = JSON.parse(extended.fact_check_violations); } catch {}
  }
  res.json({
    score, details, flaggedPatterns,
    stored_score: extended.human_score,
    factCheckPassed: extended.fact_check_passed === 1,
    factCheckViolations,
  });
});

// POST /api/applications/:id/fact-check — Manual fact check (Phase 15)
applicationsRouter.post('/:id/fact-check', async (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as ApplicationRow | undefined;
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (!app.cover_letter_text) return res.status(400).json({ error: 'No cover letter text' });

  try {
    const cv = await getStructuredCV();

    // Parse cover letter text back to content
    const lines = app.cover_letter_text.split('\n').filter((l: string) => l.trim().length > 0);
    const bodyLines: string[] = [];
    let started = false;
    for (const line of lines) {
      if (line.startsWith('Sehr geehrte') || line.startsWith('Sehr geehrter')) { started = true; continue; }
      if (line === 'Freundliche Grüsse' || line === 'Freundliche Gruesse') break;
      if (started) bodyLines.push(line);
    }

    const content = {
      betreff: '',
      anrede: '',
      absatz_1: bodyLines[0] || '',
      absatz_2: bodyLines[1] || '',
      absatz_3: bodyLines[2] || '',
      absatz_4: bodyLines[3] || '',
    };

    const result = await verifyFacts(content, cv);
    updateApplicationFactCheck(app.id, result.verified, result.violations);

    res.json(result);
  } catch (err) {
    logger.error('Manual fact check failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fact check failed' });
  }
});

// GET /api/applications/:id/pdf — Download PDF
// curl -H "Authorization: Bearer TOKEN" "http://localhost:3333/api/applications/APP_ID/pdf?type=komplett" -o bewerbung.pdf
applicationsRouter.get('/:id/pdf', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id) as ApplicationRow | undefined;
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const type = req.query.type === 'anschreiben' ? 'cover_letter_pdf_path' : 'full_package_pdf_path';
  const filePath = app[type];
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF not found' });
  }

  res.download(filePath);
});
