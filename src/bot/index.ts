import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getJobCountByStatus, getRecentJobCount, getTotalApplicationCount } from '../db/queries.js';
import { registerJobsHandlers } from './handlers/jobs.js';
import { registerApplyHandlers } from './handlers/apply.js';
import { registerEditHandlers } from './handlers/edit.js';
import { registerStatusHandlers } from './handlers/status.js';
import { registerSearchHandlers } from './handlers/search.js';

let bot: Telegraf | null = null;

export function createBot(): Telegraf {
  bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

  // Auth middleware: only allow configured chat ID
  bot.use((ctx, next) => {
    if (ctx.chat?.id.toString() !== config.TELEGRAM_CHAT_ID) {
      logger.warn(`Unauthorized access attempt from chat ID: ${ctx.chat?.id}`);
      return ctx.reply('Unauthorized.');
    }
    return next();
  });

  // /start command
  bot.command('start', (ctx) => {
    ctx.reply(
      `Willkommen bei AutoBewerber!\n\n` +
      `Verfuegbare Commands:\n` +
      `/jobs — Neue Jobs anzeigen\n` +
      `/apply <id> — Bewerbung starten\n` +
      `/preview <id> — Anschreiben anzeigen\n` +
      `/edit <id> <feedback> — Anschreiben ueberarbeiten\n` +
      `/send <id> — Bewerbung per Mail abschicken\n` +
      `/done <id> — Portal Bewerbung als gesendet markieren\n` +
      `/status — Tracking Dashboard\n` +
      `/stats — Statistiken\n` +
      `/search add|list|remove — Suchprofile verwalten\n` +
      `/update <id> <status> — Job Status aendern`
    );
  });

  // /status command
  bot.command('status', (ctx) => {
    try {
      const counts = getJobCountByStatus();
      const recentJobs = getRecentJobCount(7);
      const totalApps = getTotalApplicationCount();

      const statusLines = Object.entries(counts)
        .map(([status, count]) => `  ${status}: ${count}`)
        .join('\n');

      ctx.reply(
        `📊 AutoBewerber Status\n\n` +
        `Jobs nach Status:\n${statusLines || '  Keine Jobs vorhanden'}\n\n` +
        `Jobs letzte 7 Tage: ${recentJobs}\n` +
        `Bewerbungen gesamt: ${totalApps}`
      );
    } catch (err) {
      logger.error('Error in /status command', { error: err });
      ctx.reply('Fehler beim Laden des Status.');
    }
  });

  // Register all handler modules
  registerJobsHandlers(bot);
  registerApplyHandlers(bot);
  registerEditHandlers(bot);
  registerStatusHandlers(bot);
  registerSearchHandlers(bot);

  return bot;
}

export function startBot(): void {
  if (!bot) throw new Error('Bot not created. Call createBot() first.');

  bot.launch({
    dropPendingUpdates: true,
  }).catch((err) => {
    logger.error('Failed to start Telegram bot', { error: err });
  });

  logger.info('Telegram bot started (polling)');
}

export function stopBot(): void {
  if (bot) {
    bot.stop('SIGTERM');
    logger.info('Telegram bot stopped');
  }
}

export function getBot(): Telegraf | null {
  return bot;
}
