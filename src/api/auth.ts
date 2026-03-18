import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow health check without auth
  if (req.path === '/health') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== config.DASHBOARD_API_TOKEN) {
    res.status(401).json({ error: 'Invalid API token' });
    return;
  }

  next();
}
