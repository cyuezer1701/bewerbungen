import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return _db;
}

export function initDatabase(): void {
  if (_db) return;

  const dbDir = path.dirname(config.DB_PATH);
  fs.mkdirSync(dbDir, { recursive: true });

  _db = new Database(config.DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Try dist/db first, then src/db (for dev mode with tsx)
  let schemaPath = path.resolve(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.resolve(__dirname, '../../src/db/schema.sql');
  }
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  _db.exec(schema);

  // Run migrations for existing databases
  runMigrations(_db);

  logger.info(`Database initialized at ${config.DB_PATH}`);
}

function runMigrations(db: Database.Database): void {
  const jobCols = (db.pragma('table_info(jobs)') as Array<{ name: string }>).map(c => c.name);
  const newJobCols: Array<{ name: string; type: string }> = [
    { name: 'contact_person', type: 'TEXT' },
    { name: 'contact_gender', type: 'TEXT' },
    { name: 'contact_title', type: 'TEXT' },
    { name: 'contact_department', type: 'TEXT' },
    { name: 'reference_number', type: 'TEXT' },
    { name: 'salary_requested_in_posting', type: 'INTEGER DEFAULT 0' },
  ];
  for (const col of newJobCols) {
    if (!jobCols.includes(col.name)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${col.name} ${col.type}`);
      logger.info(`Migration: added jobs.${col.name}`);
    }
  }
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    logger.info('Database connection closed');
  }
}
