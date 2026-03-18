import { config } from './config.js';
import { logger } from './utils/logger.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { createBot, startBot, stopBot } from './bot/index.js';
import cron from 'node-cron';

function main() {
  logger.info('AutoBewerber starting...');

  // Initialize database
  initDatabase();

  // Create and start Telegram bot
  createBot();
  startBot();

  // Setup cron job for daily scraping
  cron.schedule(config.CRON_SCHEDULE, async () => {
    logger.info('Cron job triggered: starting daily scrape...');
    try {
      // Will be wired to runScrapers() in Phase 3
      logger.info('Scraper run placeholder — not yet implemented');
    } catch (err) {
      logger.error('Cron job failed', { error: err });
    }
  });

  logger.info(`Cron scheduled: ${config.CRON_SCHEDULE}`);
  logger.info('AutoBewerber is running');
}

// Graceful shutdown
function shutdown() {
  logger.info('Shutting down...');
  stopBot();
  closeDatabase();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  main();
} catch (err) {
  logger.error('Fatal error during startup', { error: err });
  process.exit(1);
}
