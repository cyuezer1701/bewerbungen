import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';
import { logger } from './utils/logger.js';

const envSchema = z.object({
  // Claude API
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-20250514'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),

  // E-Mail
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SENDER_NAME: z.string().default(''),
  SENDER_EMAIL: z.string().default(''),

  // Job Suche
  JOB_SEARCH_KEYWORDS: z.string().default('IT Service Desk,IT Coordinator,System Administrator,IT Manager'),
  JOB_SEARCH_LOCATION: z.string().default('Schweiz'),
  JOB_SEARCH_RADIUS_KM: z.coerce.number().default(50),
  JOB_MIN_MATCH_SCORE: z.coerce.number().min(0).max(100).default(65),

  // Pfade
  CV_PATH: z.string().default('./data/cv.pdf'),
  ZEUGNISSE_DIR: z.string().default('./data/zeugnisse'),
  BEWERBUNGEN_DIR: z.string().default('./data/bewerbungen'),

  // DB
  DB_PATH: z.string().default('./data/autobewerber.db'),

  // App
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  CRON_SCHEDULE: z.string().default('0 7 * * *'),
  MAX_JOBS_PER_DAY: z.coerce.number().default(20),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    logger.error(`Config validation failed:\n${errors}`);
    process.exit(1);
  }

  const env = result.data;
  const cwd = process.cwd();

  return {
    ...env,
    CV_PATH: path.resolve(cwd, env.CV_PATH),
    ZEUGNISSE_DIR: path.resolve(cwd, env.ZEUGNISSE_DIR),
    BEWERBUNGEN_DIR: path.resolve(cwd, env.BEWERBUNGEN_DIR),
    DB_PATH: path.resolve(cwd, env.DB_PATH),
  };
}

export const config = loadConfig();
export type Config = ReturnType<typeof loadConfig>;
