import type { Telegraf } from 'telegraf';
import { logger } from '../../utils/logger.js';
import {
  getJobById,
  getApplicationByJobId,
  updateApplicationSentInfo,
  updateJobStatus,
  logActivity,
} from '../../db/queries.js';
import { sendApplicationEmail } from '../../mailer/index.js';
import { afterSendKeyboard } from '../keyboards.js';

async function handleSend(
  jobId: string,
  replyFn: (text: string, extra?: unknown) => Promise<unknown>
): Promise<void> {
  const job = getJobById(jobId);
  if (!job) {
    await replyFn(`Job "${jobId}" nicht gefunden.`);
    return;
  }

  // Check application method supports email
  if (job.application_method === 'portal') {
    await replyFn(
      `Job "${job.title}" ist nur per Portal zu bewerben.\n` +
      `Nutze /done ${jobId} nachdem du dich im Portal beworben hast.`
    );
    return;
  }

  const targetEmail = job.application_email;
  if (!targetEmail) {
    await replyFn('Keine E-Mail Adresse fuer diesen Job vorhanden.');
    return;
  }

  const app = getApplicationByJobId(jobId);
  if (!app) {
    await replyFn('Keine Bewerbung vorhanden. Nutze /apply zuerst.');
    return;
  }

  if (!app.cover_letter_pdf_path && !app.full_package_pdf_path) {
    await replyFn('Keine PDFs vorhanden. Nutze /apply nochmal um PDFs zu generieren.');
    return;
  }

  try {
    await replyFn(`📧 Sende Bewerbung an ${targetEmail}...`);

    await sendApplicationEmail(job, app, targetEmail);

    // Update tracking
    updateApplicationSentInfo(app.id, 'email', targetEmail);
    updateJobStatus(jobId, 'applied');
    logActivity(jobId, app.id, 'sent', JSON.stringify({
      sent_via: 'email',
      sent_to: targetEmail,
    }));

    await replyFn(
      `📧 Bewerbung an ${targetEmail} gesendet!\n` +
      `📎 Anhang: ${app.full_package_pdf_path ? 'Komplett Paket' : 'Anschreiben'}\n` +
      `📅 Follow-up Reminder in 14 Tagen.`,
      afterSendKeyboard(jobId)
    );
  } catch (err) {
    logger.error('Failed to send application email', { error: err });
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    await replyFn(`❌ Fehler beim Senden: ${msg}`);
  }
}

export function registerSendHandlers(bot: Telegraf): void {
  // /send <id> command
  bot.command('send', async (ctx) => {
    const jobId = ctx.message.text.split(/\s+/)[1];
    if (!jobId) {
      return ctx.reply('Usage: /send <job-id>');
    }
    await handleSend(jobId, (text, extra) => ctx.reply(text, extra as never));
  });

  // Callback: Send (from inline button)
  bot.action(/^send_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();
    await handleSend(jobId, (text, extra) => ctx.reply(text, extra as never));
  });
}
