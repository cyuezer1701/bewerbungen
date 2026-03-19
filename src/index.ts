import { config } from './config.js';
import { logger } from './utils/logger.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { createBot, startBot, stopBot, getBot } from './bot/index.js';
import { runScrapers } from './scrapers/index.js';
import { runMatching } from './matching/index.js';
import { getMatchedNewJobs, getWeeklyStats, getAverageSalary, getApplicationsDueFollowUp, incrementFollowUpCount, logActivity, getActivityForJob } from './db/queries.js';
import { followUpKeyboard } from './bot/keyboards.js';
import { initAlerter, alert } from './utils/alerter.js';
import { setLastScrape, buildHealthLine } from './utils/health.js';
import { initDefaultSettings, getSetting } from './db/settings.js';
import { startApiServer } from './api/index.js';
import { testTag } from './utils/test-mode.js';
import cron from 'node-cron';

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

function buildDailyReport(scrapedCount: number, matchedCount: number): string {
  const tag = testTag();
  const matchedJobs = getMatchedNewJobs(config.JOB_MIN_MATCH_SCORE, 5);
  const weekly = getWeeklyStats();
  const salary = getAverageSalary();

  let msg = `${tag}📊 AutoBewerber Daily Report\n\n`;
  msg += `🔍 ${scrapedCount} neue Jobs gefunden\n`;
  msg += `⭐ ${matchedCount} mit Match Score > ${config.JOB_MIN_MATCH_SCORE}%\n`;

  if (salary) {
    msg += `💰 Gehaltsspanne heute: ${salary.currency} ${formatNum(salary.min)} – ${formatNum(salary.max)}\n`;
  }

  const minSalary = parseInt(getSetting('minimum_salary') || '0', 10);
  if (minSalary > 0) {
    msg += `🚫 Mindestgehalt-Filter: CHF ${formatNum(minSalary)}\n`;
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
      msg += `   💰 ${salaryStr} | ${methodIcon}\n`;

      // Recruiter info (Phase 14)
      const matchDetails = getActivityForJob(j.id, 'matched');
      if (matchDetails) {
        try {
          const details = JSON.parse(matchDetails);
          if (details.career_direction) {
            const dirMap: Record<string, string> = { aufstieg: '📈 Aufstieg', seitwaerts: '↔️ Seitwaerts', rueckschritt: '📉 Rueckschritt' };
            msg += `   ${dirMap[details.career_direction] || ''}`;
          }
          if (details.recruiter_verdict) {
            msg += `\n   💬 "${details.recruiter_verdict}"`;
          }
        } catch { /* ignore */ }
      }
      msg += '\n\n';
    }
  }

  msg += `📈 Diese Woche: ${weekly.applied} beworben, ${weekly.interview} Interview, ${weekly.rejected} Absagen\n\n`;
  msg += buildHealthLine();
  msg += `\n\nTippe /jobs fuer Details oder /apply <id> zum Bewerben`;

  return msg;
}

let pipelineRunning = false;

function main() {
  logger.info('AutoBewerber starting...');

  // Initialize database + settings
  initDatabase();
  initDefaultSettings();

  // Create and start Telegram bot
  const bot = createBot();
  startBot();

  // Initialize alerter with Telegram bot
  initAlerter(config.TELEGRAM_CHAT_ID, (chatId, message) =>
    bot.telegram.sendMessage(chatId, message)
  );

  // Start REST API server (includes /api/health, replaces standalone health server)
  startApiServer();

  // Setup cron job for scraping + matching + report
  const schedule = getSetting('scraper_schedule') || config.CRON_SCHEDULE;
  cron.schedule(schedule, async () => {
    if (pipelineRunning) {
      logger.warn('Pipeline already running, skipping duplicate cron trigger');
      return;
    }
    pipelineRunning = true;
    logger.info('Cron job triggered: starting pipeline...');
    const telegramBot = getBot();

    try {
      // Step 1: Scrape
      const jobs = await runScrapers();
      setLastScrape();
      logger.info(`Scraper done: ${jobs.length} new jobs`);

      // Step 2: Match
      const matched = await runMatching();
      logger.info(`Matching done: ${matched} jobs scored`);

      // Step 3: Send daily report
      if (telegramBot) {
        const report = buildDailyReport(jobs.length, matched);
        await telegramBot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, report);
      }

      // Step 4: Check follow-up reminders
      if (telegramBot) {
        const dueFollowUps = getApplicationsDueFollowUp();
        for (const app of dueFollowUps) {
          const reminderNum = app.follow_up_count + 1;
          let msg: string;
          if (reminderNum >= 3) {
            msg = `⏰ Follow-up #${reminderNum}: Noch keine Rueckmeldung fuer "${app.job_title}" bei ${app.job_company}.\nWahrscheinlich eine Absage.`;
          } else {
            msg = `⏰ Follow-up #${reminderNum}: Noch keine Rueckmeldung fuer "${app.job_title}" bei ${app.job_company}.`;
          }
          await telegramBot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, msg, followUpKeyboard(app.job_id));
          incrementFollowUpCount(app.id);
          logActivity(app.job_id, app.id, 'follow_up', JSON.stringify({ count: reminderNum }));
        }
      }
    } catch (err) {
      logger.error('Cron job failed', { error: err });
      await alert(`Cron Job fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
    } finally {
      pipelineRunning = false;
    }
  });

  logger.info(`Cron scheduled: ${schedule}`);
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

// Global error handlers with Telegram alerts
process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception', { error: err });
  await alert(`Uncaught Exception: ${err.message}`).catch(() => {});
  shutdown();
});

process.on('unhandledRejection', async (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error('Unhandled rejection', { error: reason });
  await alert(`Unhandled Rejection: ${msg}`).catch(() => {});
});

try {
  main();
} catch (err) {
  logger.error('Fatal error during startup', { error: err });
  process.exit(1);
}
