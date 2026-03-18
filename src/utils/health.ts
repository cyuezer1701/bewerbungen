import http from 'node:http';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from './logger.js';
import { getDb } from '../db/index.js';
import { isTestMode } from './test-mode.js';

const startTime = Date.now();
let lastScrapeAt: string | null = null;
let lastBotMessageAt: string | null = null;

export function setLastScrape(): void {
  lastScrapeAt = new Date().toISOString();
}

export function setLastBotMessage(): void {
  lastBotMessageAt = new Date().toISOString();
}

export function getHealthData(): Record<string, unknown> {
  const uptimeMs = Date.now() - startTime;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeDays = Math.floor(uptimeHours / 24);
  const remainingHours = uptimeHours % 24;

  let dbSizeMB = 0;
  let jobCount = 0;
  let appCount = 0;

  try {
    const dbPath = config.DB_PATH;
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      dbSizeMB = Math.round(stats.size / 1024 / 1024 * 10) / 10;
    }

    const db = getDb();
    const jobRow = db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number };
    const appRow = db.prepare('SELECT COUNT(*) as count FROM applications').get() as { count: number };
    jobCount = jobRow.count;
    appCount = appRow.count;
  } catch { /* ignore */ }

  return {
    status: 'ok',
    testMode: isTestMode(),
    uptime: `${uptimeDays}d ${remainingHours}h`,
    uptimeMs,
    lastScrape: lastScrapeAt,
    lastBotMessage: lastBotMessageAt,
    dbSizeMB,
    jobCount,
    applicationCount: appCount,
    nodeVersion: process.version,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

export function buildHealthLine(): string {
  const h = getHealthData();
  return `🖥️ System: OK | Uptime: ${h.uptime} | DB: ${h.dbSizeMB} MB | ${h.jobCount} Jobs | ${h.memoryMB} MB RAM`;
}

export function startHealthServer(port = 3333): void {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const data = getHealthData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    logger.info(`Health check server listening on port ${port}`);
  });
}
