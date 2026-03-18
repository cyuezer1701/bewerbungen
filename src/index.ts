import { config } from './config.js';
import { logger } from './utils/logger.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { createBot, startBot, stopBot, getBot } from './bot/index.js';
import { runScrapers } from './scrapers/index.js';
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
      const jobs = await runScrapers();
      const bot = getBot();
      if (bot && jobs.length > 0) {
        const message =
          `🔍 Scraper Report\n\n` +
          `${jobs.length} neue Jobs gefunden\n\n` +
          jobs.slice(0, 5).map((j, i) =>
            `${i + 1}. ${j.title}\n   🏢 ${j.company} | 📍 ${j.location}`
          ).join('\n\n') +
          (jobs.length > 5 ? `\n\n...und ${jobs.length - 5} weitere. /jobs fuer Details` : '');

        await bot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, message);
      } else if (bot) {
        await bot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, '🔍 Scraper Report: Keine neuen Jobs gefunden.');
      }
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
