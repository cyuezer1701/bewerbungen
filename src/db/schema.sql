-- AutoBewerber Database Schema

-- Jobs die gefunden wurden
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT,
    source_url TEXT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    description TEXT,
    salary_range TEXT,
    salary_estimate_min INTEGER,
    salary_estimate_max INTEGER,
    salary_estimate_realistic INTEGER,
    salary_currency TEXT DEFAULT 'CHF',
    salary_reasoning TEXT,
    application_method TEXT,
    application_url TEXT,
    application_email TEXT,
    posted_at TEXT,
    scraped_at TEXT DEFAULT (datetime('now')),
    match_score INTEGER,
    match_reasoning TEXT,
    status TEXT DEFAULT 'new',
    contact_person TEXT,
    contact_gender TEXT,
    contact_title TEXT,
    contact_department TEXT,
    reference_number TEXT,
    salary_requested_in_posting INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Firmenrecherche Cache
CREATE TABLE IF NOT EXISTS company_research (
    company_name TEXT PRIMARY KEY,
    full_name TEXT,
    street TEXT,
    zip TEXT,
    city TEXT,
    country TEXT,
    department TEXT,
    industry TEXT,
    employee_count TEXT,
    culture_values TEXT,
    recent_news TEXT,
    relevant_projects TEXT,
    website TEXT,
    careers_page TEXT,
    researched_at TEXT DEFAULT (datetime('now'))
);

-- Dokumente mit Kategorien
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    category TEXT DEFAULT 'zeugnis',
    document_date TEXT,
    sort_order INTEGER DEFAULT 0,
    file_size INTEGER,
    mime_type TEXT DEFAULT 'application/pdf',
    uploaded_at TEXT DEFAULT (datetime('now'))
);

-- Generierte Bewerbungen
CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    cover_letter_text TEXT,
    cover_letter_pdf_path TEXT,
    full_package_pdf_path TEXT,
    version INTEGER DEFAULT 1,
    feedback TEXT,
    sent_at TEXT,
    sent_via TEXT,
    sent_to TEXT,
    follow_up_at TEXT,
    follow_up_count INTEGER DEFAULT 0,
    human_score INTEGER,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Tracking / Timeline
CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT REFERENCES jobs(id),
    application_id TEXT REFERENCES applications(id),
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Suchprofile
CREATE TABLE IF NOT EXISTS search_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL,
    location TEXT,
    radius_km INTEGER DEFAULT 50,
    min_match_score INTEGER DEFAULT 65,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- App Settings (Key-Value Store)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    encrypted INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_match_score ON jobs(match_score);
CREATE INDEX IF NOT EXISTS idx_jobs_source_id ON jobs(source, source_id);
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_job_id ON activity_log(job_id);

-- Kandidaten-Wuensche (Phase 14)
CREATE TABLE IF NOT EXISTS candidate_wishes (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'general',
    wish TEXT NOT NULL,
    priority TEXT DEFAULT 'medium',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Kandidaten-Profil (Phase 14, Singleton)
CREATE TABLE IF NOT EXISTS candidate_profile (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    career_trajectory TEXT,
    avoid_roles TEXT,
    strengths TEXT,
    usps TEXT,
    ideal_companies TEXT,
    search_strategy_keywords TEXT,
    salary_insight TEXT,
    wishes TEXT,
    raw_assessment TEXT,
    generated_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_candidate_wishes_active ON candidate_wishes(is_active);
