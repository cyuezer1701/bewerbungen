import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { runScrapers } from '../../scrapers/index.js';
import { runMatching } from '../../matching/index.js';
import { logger } from '../../utils/logger.js';
import { getHealthData } from '../../utils/health.js';

export const actionsRouter = Router();

// GET /api/health — System health
// curl http://localhost:3333/api/health
actionsRouter.get('/health', (_req, res) => {
  res.json(getHealthData());
});

// POST /api/cron/trigger — Manually trigger complete daily run
// curl -X POST -H "Authorization: Bearer TOKEN" http://localhost:3333/api/cron/trigger
actionsRouter.post('/cron/trigger', async (_req, res) => {
  try {
    logger.info('Manual cron trigger via API');
    const jobs = await runScrapers();
    const matched = await runMatching();
    res.json({ ok: true, scraped: jobs.length, matched });
  } catch (err) {
    logger.error('Manual cron trigger failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// GET /api/activity — Activity log (paginated)
// curl -H "Authorization: Bearer TOKEN" "http://localhost:3333/api/activity?page=1&limit=50&action=matched"
actionsRouter.get('/activity', (req, res) => {
  const { action, job_id, page = '1', limit = '50' } = req.query;
  const db = getDb();

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (action) { where += ' AND action = ?'; params.push(action); }
  if (job_id) { where += ' AND job_id = ?'; params.push(job_id); }

  const offset = (Number(page) - 1) * Number(limit);
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM activity_log ${where}`).get(...params) as { total: number };
  const rows = db.prepare(`SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), offset);

  res.json({ data: rows, total: countRow.total, page: Number(page), limit: Number(limit) });
});

// GET /api/logs — Last 100 log entries
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/logs
actionsRouter.get('/logs', (_req, res) => {
  const logPath = path.resolve(process.cwd(), 'logs/combined.log');
  if (!fs.existsSync(logPath)) return res.json({ lines: [] });

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.trim().split('\n').slice(-100);
  res.json({ lines });
});

// DELETE /api/test-data — Clean up test applications
// curl -X DELETE -H "Authorization: Bearer TOKEN" http://localhost:3333/api/test-data
actionsRouter.delete('/test-data', (_req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM applications WHERE sent_via LIKE '%_test'").run();
  const logResult = db.prepare("DELETE FROM activity_log WHERE details LIKE '%\"test\":true%'").run();
  logger.info(`Test data cleanup: ${result.changes} applications, ${logResult.changes} log entries deleted`);
  res.json({ ok: true, applicationsDeleted: result.changes, logsDeleted: logResult.changes });
});
