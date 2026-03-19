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
  contact_person: string | null;
  contact_gender: string | null;
  contact_title: string | null;
  contact_department: string | null;
  reference_number: string | null;
  salary_requested_in_posting: number;
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
  contact_person?: string;
  contact_gender?: string;
  contact_title?: string;
  contact_department?: string;
  reference_number?: string;
  salary_requested_in_posting?: boolean;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO jobs (id, source, source_id, source_url, title, company, location, description,
                      salary_range, application_method, application_url, application_email, posted_at,
                      contact_person, contact_gender, contact_title, contact_department,
                      reference_number, salary_requested_in_posting)
    VALUES (@id, @source, @source_id, @source_url, @title, @company, @location, @description,
            @salary_range, @application_method, @application_url, @application_email, @posted_at,
            @contact_person, @contact_gender, @contact_title, @contact_department,
            @reference_number, @salary_requested_in_posting)
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
    contact_person: job.contact_person ?? null,
    contact_gender: job.contact_gender ?? null,
    contact_title: job.contact_title ?? null,
    contact_department: job.contact_department ?? null,
    reference_number: job.reference_number ?? null,
    salary_requested_in_posting: job.salary_requested_in_posting ? 1 : 0,
  });
}

export function updateJobAddress(
  id: string,
  contactPerson?: string,
  contactGender?: string,
  contactTitle?: string
): void {
  const db = getDb();
  const updates: string[] = [];
  const params: unknown[] = [];
  if (contactPerson !== undefined) { updates.push('contact_person = ?'); params.push(contactPerson); }
  if (contactGender !== undefined) { updates.push('contact_gender = ?'); params.push(contactGender); }
  if (contactTitle !== undefined) { updates.push('contact_title = ?'); params.push(contactTitle); }
  if (updates.length === 0) return;
  updates.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
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

export function getMatchedNewJobs(minScore: number, limit = 50): JobRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM jobs WHERE status = ? AND match_score >= ? ORDER BY match_score DESC, created_at DESC LIMIT ?'
  ).all('new', minScore, limit) as JobRow[];
}

export function getWeeklyStats(): { applied: number; interview: number; rejected: number; offer: number } {
  const db = getDb();
  const rows = db.prepare(
    "SELECT status, COUNT(*) as count FROM jobs WHERE status IN ('applied', 'interview', 'rejected', 'offer') AND updated_at >= datetime('now', '-7 days') GROUP BY status"
  ).all() as Array<{ status: string; count: number }>;
  const stats = { applied: 0, interview: 0, rejected: 0, offer: 0 };
  for (const row of rows) {
    if (row.status in stats) {
      stats[row.status as keyof typeof stats] = row.count;
    }
  }
  return stats;
}

export function getAverageSalary(): { avg: number; min: number; max: number; currency: string } | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT AVG(salary_estimate_realistic) as avg, MIN(salary_estimate_min) as min, MAX(salary_estimate_max) as max, salary_currency as currency FROM jobs WHERE salary_estimate_realistic IS NOT NULL AND status = 'new'"
  ).get() as { avg: number | null; min: number | null; max: number | null; currency: string | null };
  if (!row.avg) return null;
  return { avg: Math.round(row.avg), min: row.min ?? 0, max: row.max ?? 0, currency: row.currency ?? 'CHF' };
}

export function updateApplicationSentInfo(
  id: string,
  sentVia: string,
  sentTo: string
): void {
  const db = getDb();
  db.prepare(`
    UPDATE applications
    SET sent_at = datetime('now'), sent_via = ?, sent_to = ?,
        follow_up_at = datetime('now', '+14 days'), status = 'sent',
        updated_at = datetime('now')
    WHERE id = ?
  `).run(sentVia, sentTo, id);
}

export function updateApplicationCoverLetter(
  id: string,
  text: string,
  version: number
): void {
  const db = getDb();
  db.prepare(`
    UPDATE applications SET cover_letter_text = ?, version = ?, updated_at = datetime('now') WHERE id = ?
  `).run(text, version, id);
}

export function updateApplicationPdfPaths(
  id: string,
  pdfPath: string,
  fullPackagePath: string
): void {
  const db = getDb();
  db.prepare(`
    UPDATE applications SET cover_letter_pdf_path = ?, full_package_pdf_path = ?,
           status = 'ready', updated_at = datetime('now')
    WHERE id = ?
  `).run(pdfPath, fullPackagePath, id);
}

export function deactivateSearchProfile(id: string): void {
  const db = getDb();
  db.prepare('UPDATE search_profiles SET is_active = 0 WHERE id = ?').run(id);
}

export function getActivityForJob(jobId: string, action: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT details FROM activity_log WHERE job_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1'
  ).get(jobId, action) as { details: string | null } | undefined;
  return row?.details ?? null;
}

export function getApplicationsDueFollowUp(): Array<ApplicationRow & { job_title: string; job_company: string }> {
  const db = getDb();
  return db.prepare(`
    SELECT a.*, j.title as job_title, j.company as job_company
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.status = 'sent'
      AND a.follow_up_at IS NOT NULL
      AND a.follow_up_at <= datetime('now')
      AND a.follow_up_count < 3
  `).all() as Array<ApplicationRow & { job_title: string; job_company: string }>;
}

export function incrementFollowUpCount(id: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE applications
    SET follow_up_count = follow_up_count + 1,
        follow_up_at = datetime('now', '+14 days'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

// --- Candidate Wishes (Phase 14) ---

export interface CandidateWishRow {
  id: string;
  category: string;
  wish: string;
  priority: string;
  is_active: number;
  created_at: string;
}

export function getActiveWishes(): CandidateWishRow[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM candidate_wishes WHERE is_active = 1 ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, created_at DESC"
  ).all() as CandidateWishRow[];
}

export function getAllWishes(): CandidateWishRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM candidate_wishes ORDER BY created_at DESC').all() as CandidateWishRow[];
}

export function insertWish(wish: { id: string; category: string; wish: string; priority?: string }): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO candidate_wishes (id, category, wish, priority) VALUES (?, ?, ?, ?)'
  ).run(wish.id, wish.category, wish.wish, wish.priority || 'medium');
}

export function updateWish(id: string, updates: Partial<{ category: string; wish: string; priority: string; is_active: number }>): void {
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];
  if (updates.category !== undefined) { fields.push('category = ?'); params.push(updates.category); }
  if (updates.wish !== undefined) { fields.push('wish = ?'); params.push(updates.wish); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); params.push(updates.priority); }
  if (updates.is_active !== undefined) { fields.push('is_active = ?'); params.push(updates.is_active); }
  if (fields.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE candidate_wishes SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function deactivateWish(id: string): void {
  const db = getDb();
  db.prepare('UPDATE candidate_wishes SET is_active = 0 WHERE id = ?').run(id);
}

// --- Candidate Profile (Phase 14) ---

export interface CandidateProfileRow {
  id: string;
  career_trajectory: string | null;
  avoid_roles: string | null;
  strengths: string | null;
  usps: string | null;
  ideal_companies: string | null;
  search_strategy_keywords: string | null;
  salary_insight: string | null;
  wishes: string | null;
  raw_assessment: string | null;
  generated_at: string;
  updated_at: string;
}

export function getCandidateProfile(): CandidateProfileRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM candidate_profile WHERE id = 'singleton'").get() as CandidateProfileRow | undefined;
  return row ?? null;
}

export function upsertCandidateProfile(profile: Partial<CandidateProfileRow>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO candidate_profile (id, career_trajectory, avoid_roles, strengths, usps, ideal_companies, search_strategy_keywords, salary_insight, wishes, raw_assessment, generated_at, updated_at)
    VALUES ('singleton', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      career_trajectory = COALESCE(?, career_trajectory),
      avoid_roles = COALESCE(?, avoid_roles),
      strengths = COALESCE(?, strengths),
      usps = COALESCE(?, usps),
      ideal_companies = COALESCE(?, ideal_companies),
      search_strategy_keywords = COALESCE(?, search_strategy_keywords),
      salary_insight = COALESCE(?, salary_insight),
      wishes = COALESCE(?, wishes),
      raw_assessment = COALESCE(?, raw_assessment),
      updated_at = datetime('now')
  `).run(
    profile.career_trajectory ?? null, profile.avoid_roles ?? null,
    profile.strengths ?? null, profile.usps ?? null,
    profile.ideal_companies ?? null, profile.search_strategy_keywords ?? null,
    profile.salary_insight ?? null, profile.wishes ?? null,
    profile.raw_assessment ?? null,
    // ON CONFLICT values
    profile.career_trajectory ?? null, profile.avoid_roles ?? null,
    profile.strengths ?? null, profile.usps ?? null,
    profile.ideal_companies ?? null, profile.search_strategy_keywords ?? null,
    profile.salary_insight ?? null, profile.wishes ?? null,
    profile.raw_assessment ?? null,
  );
}

// --- Application Human Score (Phase 14) ---

export function updateApplicationHumanScore(id: string, score: number): void {
  const db = getDb();
  db.prepare("UPDATE applications SET human_score = ?, updated_at = datetime('now') WHERE id = ?").run(score, id);
}
