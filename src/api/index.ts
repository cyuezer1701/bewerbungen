import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { authMiddleware } from './auth.js';
import { jobsRouter } from './routes/jobs.js';
import { applicationsRouter } from './routes/applications.js';
import { profilesRouter } from './routes/profiles.js';
import { settingsRouter } from './routes/settings.js';
import { documentsRouter } from './routes/documents.js';
import { statsRouter } from './routes/stats.js';
import { actionsRouter } from './routes/actions.js';

export function startApiServer(): void {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use('/api', authMiddleware);

  // API Routes
  app.use('/api/jobs', jobsRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api/search-profiles', profilesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api', actionsRouter);

  // Serve dashboard static files (Phase 10)
  const dashboardPath = path.resolve(process.cwd(), 'dashboard/dist');
  if (fs.existsSync(dashboardPath)) {
    app.use(express.static(dashboardPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(dashboardPath, 'index.html'));
    });
  }

  app.listen(config.DASHBOARD_PORT, () => {
    logger.info(`API server listening on port ${config.DASHBOARD_PORT}`);
  });
}
