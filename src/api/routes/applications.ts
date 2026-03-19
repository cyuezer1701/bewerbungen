import fs from 'node:fs';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/index.js';
import {
  getJobById, getApplicationByJobId, insertApplication, updateApplicationStatus,
  updateApplicationCoverLetter, updateApplicationPdfPaths, updateApplicationSentInfo,
  updateJobStatus, logActivity,
} from '../../db/queries.js';
import { getStructuredCV } from '../../matching/cv-parser.js';
import { generateCoverLetter, formatCoverLetterForStorage } from '../../generator/cover-letter.js';
import { generateApplicationPackage } from '../../generator/pdf-builder.js';
import { sendApplicationEmail } from '../../mailer/index.js';
import { getActivityForJob } from '../../db/queries.js';
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
