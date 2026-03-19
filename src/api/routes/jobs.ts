import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { getJobById, updateJobStatus, logActivity } from '../../db/queries.js';
import { runScrapers } from '../../scrapers/index.js';
import { runMatching } from '../../matching/index.js';
import { scoreJob } from '../../matching/job-scorer.js';
import { getStructuredCV } from '../../matching/cv-parser.js';
import { updateJobMatchScore, updateJobSalaryEstimate } from '../../db/queries.js';
import { logger } from '../../utils/logger.js';
import { researchCompany, updateResearchAddress } from '../../matching/company-research.js';
import type { JobRow } from '../../db/queries.js';

export const jobsRouter = Router();

// GET /api/jobs — List with filters
// curl -H "Authorization: Bearer TOKEN" "http://localhost:3333/api/jobs?status=new&min_score=65&page=1&limit=20"
jobsRouter.get('/', (req, res) => {
  const { status, source, min_score, search, sort = 'created_at', order = 'DESC', page = '1', limit = '20' } = req.query;
  const db = getDb();

  let where = 'WHERE 1=1';
  const params: unknown[] = [];

  if (status && status !== 'all') {
    where += ' AND status = ?';
    params.push(status);
  }
  if (source) {
    where += ' AND source = ?';
    params.push(source);
  }
  if (min_score) {
    where += ' AND match_score >= ?';
    params.push(Number(min_score));
  }
  if (search) {
    where += ' AND (title LIKE ? OR company LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  // Sanitize sort column
  const validSorts = ['created_at', 'match_score', 'title', 'company', 'updated_at'];
  const sortCol = validSorts.includes(sort as string) ? sort : 'created_at';
  const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

  const offset = (Number(page) - 1) * Number(limit);
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM jobs ${where}`).get(...params) as { total: number };
  const rows = db.prepare(`SELECT * FROM jobs ${where} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), offset) as JobRow[];

  res.json({ data: rows, total: countRow.total, page: Number(page), limit: Number(limit) });
});

// GET /api/jobs/:id — Detail
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/jobs/test-job-001
jobsRouter.get('/:id', (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// PATCH /api/jobs/:id — Update status/notes
// curl -X PATCH -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"status":"reviewed"}' http://localhost:3333/api/jobs/test-job-001
jobsRouter.patch('/:id', (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { status } = req.body;
  if (status) {
    updateJobStatus(req.params.id, status);
    logActivity(req.params.id, null, 'status_changed', JSON.stringify({ from: job.status, to: status, via: 'api' }));
  }

  res.json(getJobById(req.params.id));
});

// DELETE /api/jobs/:id — Soft delete
// curl -X DELETE -H "Authorization: Bearer TOKEN" http://localhost:3333/api/jobs/test-job-001
jobsRouter.delete('/:id', (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  updateJobStatus(req.params.id, 'deleted');
  logActivity(req.params.id, null, 'status_changed', JSON.stringify({ from: job.status, to: 'deleted', via: 'api' }));
  res.json({ ok: true });
});

// POST /api/jobs/scrape-now — Trigger manual scraper run
// curl -X POST -H "Authorization: Bearer TOKEN" http://localhost:3333/api/jobs/scrape-now
jobsRouter.post('/scrape-now', async (req, res) => {
  try {
    const jobs = await runScrapers();
    const matched = await runMatching();
    res.json({ scraped: jobs.length, matched, jobs: jobs.slice(0, 10) });
  } catch (err) {
    logger.error('Manual scrape failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Scrape failed' });
  }
});

// PATCH /api/jobs/:id/address — Update company address
jobsRouter.patch('/:id/address', (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { street, zip, city } = req.body;
  if (!street || !zip || !city) {
    return res.status(400).json({ error: 'street, zip, and city are required' });
  }

  updateResearchAddress(job.company, street, zip, city);
  logActivity(req.params.id, null, 'status_changed', JSON.stringify({ action: 'address_updated', street, zip, city, via: 'api' }));
  res.json({ ok: true, company: job.company, street, zip, city });
});

// POST /api/jobs/:id/research — Trigger company research
jobsRouter.post('/:id/research', async (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    const research = await researchCompany(job.company, job.location || '');
    res.json(research);
  } catch (err) {
    logger.error('Company research failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Research failed' });
  }
});

// POST /api/jobs/:id/rematch — Re-evaluate job
// curl -X POST -H "Authorization: Bearer TOKEN" http://localhost:3333/api/jobs/test-job-001/rematch
jobsRouter.post('/:id/rematch', async (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    const cv = await getStructuredCV();
    const result = await scoreJob(job, cv);

    updateJobMatchScore(job.id, result.match_score, result.reasoning);
    updateJobSalaryEstimate(job.id, result.salary_estimate.min, result.salary_estimate.max, result.salary_estimate.realistic, result.salary_estimate.currency, result.salary_estimate.reasoning);
    logActivity(job.id, null, 'matched', JSON.stringify({ match_score: result.match_score, via: 'api' }));

    res.json({ ...result, job_id: job.id });
  } catch (err) {
    logger.error('Rematch failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rematch failed' });
  }
});
