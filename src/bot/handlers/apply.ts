import fs from 'node:fs';
import type { Telegraf } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import {
  getJobById,
  insertApplication,
  getApplicationByJobId,
  updateJobStatus,
  updateApplicationPdfPaths,
  logActivity,
  getActivityForJob,
} from '../../db/queries.js';
import { getStructuredCV } from '../../matching/cv-parser.js';
import { generateCoverLetter } from '../../generator/cover-letter.js';
import { generateApplicationPackage } from '../../generator/pdf-builder.js';
import {
  afterGeneratePortalKeyboard,
  afterGenerateEmailKeyboard,
  afterGenerateBothKeyboard,
} from '../keyboards.js';

function getCoverLetterFocus(jobId: string): string {
  const matchDetails = getActivityForJob(jobId, 'matched');
  if (matchDetails) {
    try {
      const details = JSON.parse(matchDetails);
      if (details.cover_letter_focus) return details.cover_letter_focus;
    } catch { /* ignore */ }
  }
  return 'Allgemeine Passung hervorheben';
}

function getKeyboardForMethod(jobId: string, method: string | null) {
  switch (method) {
    case 'email':
      return afterGenerateEmailKeyboard(jobId);
    case 'both':
      return afterGenerateBothKeyboard(jobId);
    default:
      return afterGeneratePortalKeyboard(jobId);
  }
}

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

async function handleApply(jobId: string, replyFn: (text: string, extra?: unknown) => Promise<unknown>) {
  const job = getJobById(jobId);
  if (!job) {
    await replyFn(`Job "${jobId}" nicht gefunden.`);
    return;
  }

  await replyFn(`📄 Anschreiben fuer "${job.title}" @ ${job.company} wird generiert...`);

  const cv = await getStructuredCV();
  const focus = getCoverLetterFocus(job.id);
  const coverLetter = await generateCoverLetter(job, cv, focus);
  const wordCount = coverLetter.split(/\s+/).length;

  // Save application
  const appId = uuidv4();
  insertApplication({
    id: appId,
    job_id: job.id,
    cover_letter_text: coverLetter,
  });

  updateJobStatus(job.id, 'applying');

  // Generate PDFs
  let pdfInfo = '';
  try {
    const { pdfPath, fullPackagePath } = await generateApplicationPackage(job, coverLetter, cv);
    updateApplicationPdfPaths(appId, pdfPath, fullPackagePath);
    pdfInfo = `\n📎 Anschreiben PDF erstellt\n📎 Komplett Paket erstellt`;
    logActivity(job.id, appId, 'generated', JSON.stringify({
      version: 1,
      word_count: wordCount,
      pdf_path: pdfPath,
      full_package_path: fullPackagePath,
    }));
  } catch (err) {
    logger.error('PDF generation failed, continuing with text only', { error: err });
    pdfInfo = '\n⚠️ PDF Generierung fehlgeschlagen (Text verfuegbar)';
    logActivity(job.id, appId, 'generated', JSON.stringify({ version: 1, word_count: wordCount }));
  }

  // Build confirmation message
  let msg = `✅ Bewerbung ready!\n📌 ${job.title} @ ${job.company}\n`;
  if (job.salary_estimate_realistic) {
    msg += `💰 ~${job.salary_currency || 'CHF'} ${formatNum(job.salary_estimate_realistic)}\n`;
  }
  if (job.application_email) msg += `📧 ${job.application_email}\n`;
  if (job.application_url) msg += `🔗 ${job.application_url}\n`;
  msg += `\n📎 Anschreiben (v1) — ${wordCount} Woerter${pdfInfo}`;

  await replyFn(msg, getKeyboardForMethod(job.id, job.application_method));
}

export function registerApplyHandlers(bot: Telegraf): void {
  // /apply <id> command
  bot.command('apply', async (ctx) => {
    const jobId = ctx.message.text.split(/\s+/)[1];
    if (!jobId) {
      return ctx.reply('Usage: /apply <job-id>');
    }

    try {
      await handleApply(jobId, (text, extra) => ctx.reply(text, extra as never));
    } catch (err) {
      logger.error('Error in /apply command', { error: err });
      ctx.reply('Fehler bei der Generierung des Anschreibens.');
    }
  });

  // Callback: Apply (from job list)
  bot.action(/^apply_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();

    try {
      await handleApply(jobId, (text, extra) => ctx.reply(text, extra as never));
    } catch (err) {
      logger.error('Error in apply callback', { error: err });
      ctx.reply('Fehler bei der Generierung des Anschreibens.');
    }
  });

  // Callback: Preview
  bot.action(/^preview_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();

    const app = getApplicationByJobId(jobId);
    if (!app?.cover_letter_text) {
      return ctx.reply('Kein Anschreiben gefunden. Nutze /apply zuerst.');
    }

    const job = getJobById(jobId);
    const title = job ? `${job.title} @ ${job.company}` : jobId;
    await ctx.reply(`📄 Anschreiben (v${app.version}) fuer ${title}:\n\n${app.cover_letter_text}`);
  });

  // Callback: PDF download
  bot.action(/^pdf_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();

    const app = getApplicationByJobId(jobId);
    if (!app) {
      return ctx.reply('Keine Bewerbung gefunden. Nutze /apply zuerst.');
    }

    const job = getJobById(jobId);

    // Send cover letter PDF
    if (app.cover_letter_pdf_path && fs.existsSync(app.cover_letter_pdf_path)) {
      await ctx.replyWithDocument({
        source: app.cover_letter_pdf_path,
        filename: `anschreiben_${job ? job.company.toLowerCase().replace(/\s+/g, '_') : 'bewerbung'}.pdf`,
      });
    }

    // Send complete package PDF
    if (app.full_package_pdf_path && fs.existsSync(app.full_package_pdf_path)) {
      await ctx.replyWithDocument({
        source: app.full_package_pdf_path,
        filename: `komplett_${job ? job.company.toLowerCase().replace(/\s+/g, '_') : 'bewerbung'}.pdf`,
      });
    }

    if (!app.cover_letter_pdf_path && !app.full_package_pdf_path) {
      await ctx.reply('Keine PDFs vorhanden. Versuche /apply nochmal.');
    }

    // Show portal link if applicable
    if (job?.application_url && (job.application_method === 'portal' || job.application_method === 'both')) {
      await ctx.reply(`🔗 Zum Bewerbungsportal:\n${job.application_url}\n\nWenn hochgeladen, tippe /done ${jobId}`);
    }
  });

  // /preview command
  bot.command('preview', async (ctx) => {
    const jobId = ctx.message.text.split(/\s+/)[1];
    if (!jobId) {
      return ctx.reply('Usage: /preview <job-id>');
    }

    const app = getApplicationByJobId(jobId);
    if (!app?.cover_letter_text) {
      return ctx.reply('Kein Anschreiben gefunden. Nutze /apply zuerst.');
    }

    const job = getJobById(jobId);
    const title = job ? `${job.title} @ ${job.company}` : jobId;
    await ctx.reply(`📄 Anschreiben (v${app.version}) fuer ${title}:\n\n${app.cover_letter_text}`);
  });
}
