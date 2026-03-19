import crypto from 'node:crypto';
import { getDb } from './index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getKey(): Buffer {
  return Buffer.from(config.ENCRYPTION_KEY, 'hex');
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
  const [ivHex, encrypted] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const SENSITIVE_KEYS = new Set([
  'smtp_pass',
  'telegram_bot_token',
  'dashboard_api_token',
]);

const DEFAULTS: Record<string, { value: string; encrypted: boolean }> = {
  search_keywords: { value: config.JOB_SEARCH_KEYWORDS, encrypted: false },
  search_location: { value: config.JOB_SEARCH_LOCATION, encrypted: false },
  search_radius_km: { value: String(config.JOB_SEARCH_RADIUS_KM), encrypted: false },
  min_match_score: { value: String(config.JOB_MIN_MATCH_SCORE), encrypted: false },
  max_jobs_per_day: { value: String(config.MAX_JOBS_PER_DAY), encrypted: false },
  scraper_linkedin_enabled: { value: 'true', encrypted: false },
  scraper_indeed_enabled: { value: 'true', encrypted: false },
  scraper_jobsch_enabled: { value: 'true', encrypted: false },
  scraper_proxy: { value: '', encrypted: false },
  scraper_schedule: { value: config.CRON_SCHEDULE, encrypted: false },
  claude_model: { value: config.CLAUDE_MODEL, encrypted: false },
  claude_max_parallel: { value: '10', encrypted: false },
  claude_language: { value: 'de-CH', encrypted: false },
  cover_letter_style: { value: 'formal', encrypted: false },
  cover_letter_length: { value: 'mittel', encrypted: false },
  cover_letter_no_hyphens: { value: 'true', encrypted: false },
  cover_letter_custom_rules: { value: '', encrypted: false },
  sender_name: { value: config.SENDER_NAME, encrypted: false },
  sender_email: { value: config.SENDER_EMAIL, encrypted: false },
  sender_phone: { value: '', encrypted: false },
  sender_address_street: { value: '', encrypted: false },
  sender_address_city: { value: '', encrypted: false },
  sender_address_zip: { value: '', encrypted: false },
  sender_address_country: { value: 'Schweiz', encrypted: false },
  smtp_host: { value: config.SMTP_HOST, encrypted: false },
  smtp_port: { value: String(config.SMTP_PORT), encrypted: false },
  smtp_user: { value: config.SMTP_USER, encrypted: false },
  smtp_pass: { value: config.SMTP_PASS, encrypted: true },
  email_subject_template: { value: 'Bewerbung als {job_title}', encrypted: false },
  email_bcc_self: { value: 'true', encrypted: false },
  telegram_bot_token: { value: config.TELEGRAM_BOT_TOKEN, encrypted: true },
  telegram_chat_id: { value: config.TELEGRAM_CHAT_ID, encrypted: false },
  telegram_daily_report: { value: 'true', encrypted: false },
  telegram_error_alerts: { value: 'true', encrypted: false },
  followup_first_days: { value: '14', encrypted: false },
  followup_second_days: { value: '30', encrypted: false },
  followup_auto_reject_days: { value: '45', encrypted: false },
  minimum_salary: { value: '0', encrypted: false },
  salary_currency_default: { value: 'CHF', encrypted: false },
  dashboard_port: { value: String(config.DASHBOARD_PORT), encrypted: false },
  dashboard_api_token: { value: config.DASHBOARD_API_TOKEN, encrypted: true },
  test_mode: { value: 'false', encrypted: false },
  test_mode_email: { value: '', encrypted: false },
  salary_expectation_min: { value: '0', encrypted: false },
  salary_expectation_max: { value: '0', encrypted: false },
  salary_expectation_ideal: { value: '0', encrypted: false },
  sender_available_from: { value: 'sofort', encrypted: false },
  documents_order: { value: 'cover_letter,cv,zeugnisse,diplome,weiterbildungen', encrypted: false },
  ai_recruiter_enabled: { value: 'true', encrypted: false },
  ai_recruiter_aggressiveness: { value: 'balanced', encrypted: false },
  human_score_minimum: { value: '70', encrypted: false },
  human_score_auto_retry: { value: 'true', encrypted: false },
};

export function initDefaultSettings(): void {
  const db = getDb();
  const existing = db.prepare('SELECT key FROM settings').all() as Array<{ key: string }>;
  const existingKeys = new Set(existing.map((r) => r.key));

  const insert = db.prepare(
    "INSERT INTO settings (key, value, encrypted) VALUES (?, ?, ?)"
  );

  let count = 0;
  for (const [key, def] of Object.entries(DEFAULTS)) {
    if (existingKeys.has(key)) continue;
    const val = def.encrypted ? encrypt(def.value) : def.value;
    insert.run(key, val, def.encrypted ? 1 : 0);
    count++;
  }

  if (count > 0) {
    logger.info(`Initialized ${count} default settings`);
  }

  // Migrate scraper_schedule from old default to new 2x daily schedule
  if (existingKeys.has('scraper_schedule')) {
    const currentSchedule = db.prepare('SELECT value FROM settings WHERE key = ?').get('scraper_schedule') as { value: string } | undefined;
    if (currentSchedule?.value === '0 7 * * *') {
      db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?")
        .run('0 7,17 * * *', 'scraper_schedule');
      logger.info('Migrated scraper_schedule from "0 7 * * *" to "0 7,17 * * *"');
    }
  }
}

export function getSetting(key: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value, encrypted FROM settings WHERE key = ?').get(key) as
    | { value: string; encrypted: number }
    | undefined;
  if (!row) return '';
  return row.encrypted ? decrypt(row.value) : row.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  const isEncrypted = SENSITIVE_KEYS.has(key);
  const storedValue = isEncrypted ? encrypt(value) : value;
  db.prepare(
    "INSERT INTO settings (key, value, encrypted) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, encrypted = ?, updated_at = datetime('now')"
  ).run(key, storedValue, isEncrypted ? 1 : 0, storedValue, isEncrypted ? 1 : 0);
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value, encrypted FROM settings').all() as Array<{
    key: string;
    value: string;
    encrypted: number;
  }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    try {
      result[row.key] = row.encrypted ? decrypt(row.value) : row.value;
    } catch {
      result[row.key] = '';
    }
  }
  return result;
}

export function getAllSettingsMasked(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value, encrypted FROM settings').all() as Array<{
    key: string;
    value: string;
    encrypted: number;
  }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.encrypted) {
      result[row.key] = '••••••••';
    } else {
      result[row.key] = row.value;
    }
  }
  return result;
}

export function getSettingsSchema(): Array<{ key: string; type: string; default: string; sensitive: boolean }> {
  return Object.entries(DEFAULTS).map(([key, def]) => ({
    key,
    type: ['true', 'false'].includes(def.value) ? 'boolean' : isNaN(Number(def.value)) || def.value === '' ? 'string' : 'number',
    default: def.encrypted ? '••••••••' : def.value,
    sensitive: def.encrypted,
  }));
}
