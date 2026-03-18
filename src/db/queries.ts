import { getDb } from './index.js';

// Row types matching the DB schema
export interface JobRow {
  id: string;
  source: string;
  source_id: string | null;
  source_url: string | null;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  salary_range: string | null;
  salary_estimate_min: number | null;
  salary_estimate_max: number | null;
  salary_estimate_realistic: number | null;
  salary_currency: string;
  salary_reasoning: string | null;
  application_method: string | null;
  application_url: string | null;
  application_email: string | null;
  posted_at: string | null;
  scraped_at: string;
  match_score: number | null;
  match_reasoning: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ApplicationRow {
  id: string;
  job_id: string;
  cover_letter_text: string | null;
  cover_letter_pdf_path: string | null;
  full_package_pdf_path: string | null;
  version: number;
  feedback: string | null;
  sent_at: string | null;
  sent_via: string | null;
  sent_to: string | null;
  follow_up_at: string | null;
  follow_up_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ActivityLogRow {
  id: number;
  job_id: string | null;
  application_id: string | null;
  action: string;
  details: string | null;
  created_at: string;
}

export interface SearchProfileRow {
  id: string;
  name: string;
  keywords: string;
  location: string | null;
  radius_km: number;
  min_match_score: number;
  is_active: number;
  created_at: string;
}

// --- Job Queries ---

export function insertJob(job: {
  id: string;
  source: string;
  source_id?: string;
  source_url?: string;
  title: string;
  company: string;
  location?: string;
  description?: string;
  salary_range?: string;
  application_method?: string;
  application_url?: string;
  application_email?: string;
  posted_at?: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO jobs (id, source, source_id, source_url, title, company, location, description,
                      salary_range, application_method, application_url, application_email, posted_at)
    VALUES (@id, @source, @source_id, @source_url, @title, @company, @location, @description,
            @salary_range, @application_method, @application_url, @application_email, @posted_at)
  `).run({
    id: job.id,
    source: job.source,
    source_id: job.source_id ?? null,
    source_url: job.source_url ?? null,
    title: job.title,
    company: job.company,
    location: job.location ?? null,
    description: job.description ?? null,
    salary_range: job.salary_range ?? null,
    application_method: job.application_method ?? null,
    application_url: job.application_url ?? null,
    application_email: job.application_email ?? null,
    posted_at: job.posted_at ?? null,
  });
}

export function getJobById(id: string): JobRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

export function getJobBySourceId(source: string, sourceId: string): JobRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE source = ? AND source_id = ?').get(source, sourceId) as JobRow | undefined;
}

export function getUnmatchedJobs(limit = 50): JobRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE status = ? AND match_score IS NULL ORDER BY created_at DESC LIMIT ?').all('new', limit) as JobRow[];
}

export function getNewJobs(limit = 50): JobRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY match_score DESC, created_at DESC LIMIT ?').all('new', limit) as JobRow[];
}

export function getJobsByStatus(status: string): JobRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC').all(status) as JobRow[];
}

export function updateJobMatchScore(
  id: string,
  matchScore: number,
  matchReasoning: string
): void {
  const db = getDb();
  db.prepare(`
    UPDATE jobs SET match_score = ?, match_reasoning = ?, updated_at = datetime('now') WHERE id = ?
  `).run(matchScore, matchReasoning, id);
}

export function updateJobSalaryEstimate(
  id: string,
  min: number,
  max: number,
  realistic: number,
  currency: string,
  reasoning: string
): void {
  const db = getDb();
  db.prepare(`
    UPDATE jobs SET salary_estimate_min = ?, salary_estimate_max = ?, salary_estimate_realistic = ?,
                    salary_currency = ?, salary_reasoning = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(min, max, realistic, currency, reasoning, id);
}

export function updateJobStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

// --- Application Queries ---

export function insertApplication(app: {
  id: string;
  job_id: string;
  cover_letter_text?: string;
  cover_letter_pdf_path?: string;
  full_package_pdf_path?: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO applications (id, job_id, cover_letter_text, cover_letter_pdf_path, full_package_pdf_path)
    VALUES (@id, @job_id, @cover_letter_text, @cover_letter_pdf_path, @full_package_pdf_path)
  `).run({
    id: app.id,
    job_id: app.job_id,
    cover_letter_text: app.cover_letter_text ?? null,
    cover_letter_pdf_path: app.cover_letter_pdf_path ?? null,
    full_package_pdf_path: app.full_package_pdf_path ?? null,
  });
}

export function getApplicationByJobId(jobId: string): ApplicationRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM applications WHERE job_id = ? ORDER BY version DESC LIMIT 1').get(jobId) as ApplicationRow | undefined;
}

export function updateApplicationStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare("UPDATE applications SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

// --- Activity Log ---

export function logActivity(
  jobId: string | null,
  applicationId: string | null,
  action: string,
  details?: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO activity_log (job_id, application_id, action, details)
    VALUES (?, ?, ?, ?)
  `).run(jobId, applicationId, action, details ?? null);
}

// --- Search Profiles ---

export function getActiveSearchProfiles(): SearchProfileRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM search_profiles WHERE is_active = 1').all() as SearchProfileRow[];
}

export function insertSearchProfile(profile: {
  id: string;
  name: string;
  keywords: string;
  location?: string;
  radius_km?: number;
  min_match_score?: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO search_profiles (id, name, keywords, location, radius_km, min_match_score)
    VALUES (@id, @name, @keywords, @location, @radius_km, @min_match_score)
  `).run({
    id: profile.id,
    name: profile.name,
    keywords: profile.keywords,
    location: profile.location ?? null,
    radius_km: profile.radius_km ?? 50,
    min_match_score: profile.min_match_score ?? 65,
  });
}

// --- Stats ---

export function getJobCountByStatus(): Record<string, number> {
  const db = getDb();
  const rows = db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all() as Array<{ status: string; count: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.status] = row.count;
  }
  return result;
}

export function getRecentJobCount(days: number): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM jobs WHERE created_at >= datetime('now', ?)"
  ).get(`-${days} days`) as { count: number };
  return row.count;
}

export function getTotalApplicationCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM applications').get() as { count: number };
  return row.count;
}
