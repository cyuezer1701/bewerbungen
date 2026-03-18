import { config } from './config.js';
import { logger } from './utils/logger.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { createBot, startBot, stopBot, getBot } from './bot/index.js';
import { runScrapers } from './scrapers/index.js';
import { runMatching } from './matching/index.js';
import { getMatchedNewJobs, getWeeklyStats, getAverageSalary } from './db/queries.js';
import cron from 'node-cron';

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

function buildDailyReport(scrapedCount: number, matchedCount: number): string {
  const matchedJobs = getMatchedNewJobs(config.JOB_MIN_MATCH_SCORE, 5);
  const weekly = getWeeklyStats();
  const salary = getAverageSalary();

  let msg = `📊 AutoBewerber Daily Report\n\n`;
  msg += `🔍 ${scrapedCount} neue Jobs gefunden\n`;
  msg += `⭐ ${matchedCount} mit Match Score > ${config.JOB_MIN_MATCH_SCORE}%\n`;

  if (salary) {
    msg += `💰 Gehaltsspanne heute: ${salary.currency} ${formatNum(salary.min)} – ${formatNum(salary.max)}\n`;
  }

  if (matchedJobs.length > 0) {
    msg += `\nTop ${matchedJobs.length} Matches:\n\n`;
    for (let i = 0; i < matchedJobs.length; i++) {
      const j = matchedJobs[i];
      const methodIcon = j.application_method === 'email' ? '📧 Mail' : '📝 Portal';
      const salaryStr = j.salary_estimate_realistic
        ? `~${j.salary_currency || 'CHF'} ${formatNum(j.salary_estimate_realistic)}`
        : 'k.A.';

      msg += `${i + 1}. 🎯 ${j.match_score}% | ${j.title}\n`;
      msg += `   🏢 ${j.company} | 📍 ${j.location || 'k.A.'}\n`;
      msg += `   💰 ${salaryStr} | ${methodIcon}\n\n`;
    }
  }

  msg += `📈 Diese Woche: ${weekly.applied} beworben, ${weekly.interview} Interview, ${weekly.rejected} Absagen\n\n`;
  msg += `Tippe /jobs fuer Details oder /apply <id> zum Bewerben`;

  return msg;
}

function main() {
  logger.info('AutoBewerber starting...');

  // Initialize database
  initDatabase();

  // Create and start Telegram bot
  createBot();
  startBot();

  // Setup cron job for daily scraping + matching + report
  cron.schedule(config.CRON_SCHEDULE, async () => {
    logger.info('Cron job triggered: starting daily pipeline...');
    const bot = getBot();

    try {
      // Step 1: Scrape
      const jobs = await runScrapers();
      logger.info(`Scraper done: ${jobs.length} new jobs`);

      // Step 2: Match
      const matched = await runMatching();
      logger.info(`Matching done: ${matched} jobs scored`);

      // Step 3: Send daily report
      if (bot) {
        const report = buildDailyReport(jobs.length, matched);
        await bot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, report);
      }
    } catch (err) {
      logger.error('Cron job failed', { error: err });
      if (bot) {
        await bot.telegram.sendMessage(
          config.TELEGRAM_CHAT_ID,
          `⚠️ Cron Job Fehler: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`
        ).catch(() => {});
      }
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
