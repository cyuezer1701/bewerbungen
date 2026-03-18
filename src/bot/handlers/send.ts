import type { Telegraf } from 'telegraf';
import { logger } from '../../utils/logger.js';
import { testTag, testSentVia } from '../../utils/test-mode.js';
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
    const tag = testTag();
    await replyFn(`${tag}📧 Sende Bewerbung an ${targetEmail}...`);

    const { actualRecipient, testMode } = await sendApplicationEmail(job, app, targetEmail);

    const sentVia = testSentVia('email');
    updateApplicationSentInfo(app.id, sentVia, actualRecipient);
    updateJobStatus(jobId, 'applied');
    logActivity(jobId, app.id, 'sent', JSON.stringify({
      sent_via: sentVia,
      sent_to: actualRecipient,
      original_target: targetEmail,
      test: testMode,
    }));

    if (testMode) {
      await replyFn(
        `${tag}📧 TEST: Mail an ${actualRecipient} statt an ${targetEmail}\n` +
        `📎 Anhang: ${app.full_package_pdf_path ? 'Komplett Paket' : 'Anschreiben'}\n` +
        `📅 Follow-up Reminder in 14 Tagen.`,
        afterSendKeyboard(jobId)
      );
    } else {
      await replyFn(
        `📧 Bewerbung an ${targetEmail} gesendet!\n` +
        `📎 Anhang: ${app.full_package_pdf_path ? 'Komplett Paket' : 'Anschreiben'}\n` +
        `📅 Follow-up Reminder in 14 Tagen.`,
        afterSendKeyboard(jobId)
      );
    }
  } catch (err) {
    logger.error('Failed to send application email', { error: err });
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
    await replyFn(`❌ Fehler beim Senden: ${msg}`);
  }
}

export function registerSendHandlers(bot: Telegraf): void {
  bot.command('send', async (ctx) => {
    const jobId = ctx.message.text.split(/\s+/)[1];
    if (!jobId) return ctx.reply('Usage: /send <job-id>');
    await handleSend(jobId, (text, extra) => ctx.reply(text, extra as never));
  });

  bot.action(/^send_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();
    await handleSend(jobId, (text, extra) => ctx.reply(text, extra as never));
  });
}
