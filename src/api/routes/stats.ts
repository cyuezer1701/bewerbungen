import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { getJobCountByStatus, getRecentJobCount, getTotalApplicationCount, getWeeklyStats, getAverageSalary, getOutcomeSummary, getOutcomeTotal } from '../../db/queries.js';

export const statsRouter = Router();

// GET /api/stats — Dashboard KPIs
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/stats
statsRouter.get('/', (_req, res) => {
  const counts = getJobCountByStatus();
  const recentJobs = getRecentJobCount(7);
  const totalApps = getTotalApplicationCount();
  const weekly = getWeeklyStats();
  const salary = getAverageSalary();

  res.json({
    jobs_total: Object.values(counts).reduce((a, b) => a + b, 0),
    jobs_by_status: counts,
    jobs_this_week: recentJobs,
    applications_total: totalApps,
    weekly_stats: weekly,
    salary_overview: salary,
  });
});

// GET /api/stats/salary-analysis
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/stats/salary-analysis
statsRouter.get('/salary-analysis', (_req, res) => {
  const db = getDb();

  const overall = db.prepare(`
    SELECT AVG(salary_estimate_realistic) as avg, MIN(salary_estimate_min) as min,
           MAX(salary_estimate_max) as max, salary_currency as currency,
           COUNT(*) as count
    FROM jobs WHERE salary_estimate_realistic IS NOT NULL
    GROUP BY salary_currency
  `).all();

  const bySource = db.prepare(`
    SELECT source, AVG(salary_estimate_realistic) as avg_salary, COUNT(*) as count
    FROM jobs WHERE salary_estimate_realistic IS NOT NULL
    GROUP BY source
  `).all();

  res.json({ overall, by_source: bySource });
});

// GET /api/stats/funnel
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/stats/funnel
statsRouter.get('/funnel', (_req, res) => {
  const db = getDb();
  const funnel = db.prepare(`
    SELECT status, COUNT(*) as count FROM jobs
    WHERE status IN ('new', 'reviewed', 'applying', 'applied', 'interview', 'rejected', 'offer')
    GROUP BY status
  `).all() as Array<{ status: string; count: number }>;

  const stages = ['new', 'reviewed', 'applying', 'applied', 'interview', 'offer', 'rejected'];
  const result = stages.map(s => ({
    stage: s,
    count: funnel.find(f => f.status === s)?.count || 0,
  }));

  res.json(result);
});

// GET /api/stats/outcomes — Success rates by score range (Phase 15)
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/stats/outcomes
statsRouter.get('/outcomes', (_req, res) => {
  const outcomes = getOutcomeSummary();
  const total = getOutcomeTotal();
  res.json({ outcomes, total });
});

// GET /api/stats/timeline — Weekly activity
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/stats/timeline
statsRouter.get('/timeline', (_req, res) => {
  const db = getDb();
  const weeks = db.prepare(`
    SELECT strftime('%Y-W%W', created_at) as week,
           action,
           COUNT(*) as count
    FROM activity_log
    WHERE created_at >= datetime('now', '-12 weeks')
    GROUP BY week, action
    ORDER BY week
  `).all();

  res.json(weeks);
});
