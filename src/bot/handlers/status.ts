import type { Telegraf } from 'telegraf';
import { logger } from '../../utils/logger.js';
import {
  getJobById,
  getJobCountByStatus,
  getRecentJobCount,
  getTotalApplicationCount,
  getWeeklyStats,
  getAverageSalary,
  updateJobStatus,
  getApplicationByJobId,
  updateApplicationSentInfo,
  logActivity,
} from '../../db/queries.js';
import { afterSendKeyboard } from '../keyboards.js';

export function registerStatusHandlers(bot: Telegraf): void {
  // /stats command
  bot.command('stats', (ctx) => {
    try {
      const counts = getJobCountByStatus();
      const recentJobs = getRecentJobCount(7);
      const totalApps = getTotalApplicationCount();
      const weekly = getWeeklyStats();
      const salary = getAverageSalary();

      let msg = `📊 AutoBewerber Statistiken\n\n`;
      msg += `🔍 Jobs letzte 7 Tage: ${recentJobs}\n`;
      msg += `📝 Bewerbungen gesamt: ${totalApps}\n\n`;

      msg += `📈 Diese Woche:\n`;
      msg += `  Beworben: ${weekly.applied}\n`;
      msg += `  Interviews: ${weekly.interview}\n`;
      msg += `  Absagen: ${weekly.rejected}\n`;
      msg += `  Angebote: ${weekly.offer}\n\n`;

      if (salary) {
        msg += `💰 Gehaltsspanne (neue Jobs):\n`;
        msg += `  ${salary.currency} ${formatNum(salary.min)} – ${formatNum(salary.max)}\n`;
        msg += `  Durchschnitt: ~${formatNum(salary.avg)}\n\n`;
      }

      const totalJobs = Object.values(counts).reduce((a, b) => a + b, 0);
      if (totalJobs > 0) {
        msg += `Jobs gesamt: ${totalJobs}\n`;
        for (const [status, count] of Object.entries(counts)) {
          msg += `  ${status}: ${count}\n`;
        }
      }

      ctx.reply(msg);
    } catch (err) {
      logger.error('Error in /stats command', { error: err });
      ctx.reply('Fehler beim Laden der Statistiken.');
    }
  });

  // /update <id> <status>
  bot.command('update', (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    const jobId = parts[1];
    const newStatus = parts[2];
    const validStatuses = ['new', 'reviewed', 'applying', 'applied', 'interview', 'rejected', 'offer'];

    if (!jobId || !newStatus) {
      return ctx.reply(`Usage: /update <job-id> <status>\nGueltige Status: ${validStatuses.join(', ')}`);
    }

    if (!validStatuses.includes(newStatus)) {
      return ctx.reply(`Ungueltiger Status. Gueltig: ${validStatuses.join(', ')}`);
    }

    const job = getJobById(jobId);
    if (!job) {
      return ctx.reply(`Job "${jobId}" nicht gefunden.`);
    }

    const oldStatus = job.status;
    updateJobStatus(jobId, newStatus);
    logActivity(jobId, null, 'status_changed', JSON.stringify({ from: oldStatus, to: newStatus }));

    ctx.reply(`✅ Job "${job.title}" Status: ${oldStatus} → ${newStatus}`);
  });

  // /done <id>
  bot.command('done', (ctx) => {
    const jobId = ctx.message.text.split(/\s+/)[1];
    if (!jobId) {
      return ctx.reply('Usage: /done <job-id>');
    }

    const job = getJobById(jobId);
    if (!job) {
      return ctx.reply(`Job "${jobId}" nicht gefunden.`);
    }

    updateJobStatus(jobId, 'applied');

    const app = getApplicationByJobId(jobId);
    if (app) {
      updateApplicationSentInfo(app.id, 'portal', job.application_url || 'portal');
    }

    logActivity(jobId, app?.id ?? null, 'status_changed', JSON.stringify({
      from: job.status,
      to: 'applied',
      sent_via: 'portal',
    }));

    ctx.reply(
      `✅ Job "${job.title}" als "applied (portal)" markiert.\n📅 Follow-up Reminder in 14 Tagen.`,
      app ? afterSendKeyboard(jobId) : undefined
    );
  });

  // Callback: Status updates from afterSendKeyboard
  bot.action(/^status_(.+)_(interview|rejected|offer)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const newStatus = ctx.match[2];
    await ctx.answerCbQuery();

    const job = getJobById(jobId);
    if (!job) return;

    updateJobStatus(jobId, newStatus);
    logActivity(jobId, null, 'status_changed', JSON.stringify({ from: job.status, to: newStatus }));

    const labels: Record<string, string> = {
      interview: '🎉 Interview erhalten',
      rejected: '❌ Absage erhalten',
      offer: '🎊 Angebot erhalten',
    };

    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(`${labels[newStatus]} fuer "${job.title}" @ ${job.company}`);
  });

  // Callback: Follow-up actions
  bot.action(/^update_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply(`Status updaten: /update ${jobId} <status>\nGueltige Status: interview, rejected, offer`);
  });

  bot.action(/^followup_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();
    const job = getJobById(jobId);
    if (!job) return;

    if (job.application_email) {
      await ctx.reply(`📧 Nachfass E-Mail senden an ${job.application_email}?\nNutze /send ${jobId}`);
    } else {
      await ctx.reply(`Nachfassen fuer "${job.title}" bei ${job.company}.\nBewerbungsportal: ${job.application_url || 'nicht verfuegbar'}`);
    }
  });

  bot.action(/^archive_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();
    const job = getJobById(jobId);
    if (!job) return;

    updateJobStatus(jobId, 'rejected');
    logActivity(jobId, null, 'status_changed', JSON.stringify({ from: job.status, to: 'rejected', reason: 'archived' }));
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(`📁 "${job.title}" bei ${job.company} archiviert (als Absage markiert).`);
  });
}

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}
