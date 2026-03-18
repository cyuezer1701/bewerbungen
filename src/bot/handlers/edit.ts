import type { Telegraf } from 'telegraf';
import { logger } from '../../utils/logger.js';
import {
  getJobById,
  getApplicationByJobId,
  updateApplicationCoverLetter,
  updateApplicationPdfPaths,
  logActivity,
} from '../../db/queries.js';
import { getStructuredCV } from '../../matching/cv-parser.js';
import { generateCoverLetter } from '../../generator/cover-letter.js';
import { generateApplicationPackage } from '../../generator/pdf-builder.js';
import { getActivityForJob } from '../../db/queries.js';
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

export function registerEditHandlers(bot: Telegraf): void {
  // /edit <id> <feedback>
  bot.command('edit', async (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    const jobId = parts[1];
    const feedback = parts.slice(2).join(' ');

    if (!jobId || !feedback) {
      return ctx.reply('Usage: /edit <job-id> <dein feedback>');
    }

    const job = getJobById(jobId);
    if (!job) {
      return ctx.reply(`Job "${jobId}" nicht gefunden.`);
    }

    const existingApp = getApplicationByJobId(jobId);
    if (!existingApp) {
      return ctx.reply('Kein Anschreiben vorhanden. Nutze /apply zuerst.');
    }

    try {
      await ctx.reply(`📝 Ueberarbeite Anschreiben fuer "${job.title}" mit deinem Feedback...`);

      const cv = await getStructuredCV();
      const focus = getCoverLetterFocus(job.id);
      const newCoverLetter = await generateCoverLetter(job, cv, focus, feedback);
      const wordCount = newCoverLetter.split(/\s+/).length;
      const newVersion = existingApp.version + 1;

      updateApplicationCoverLetter(existingApp.id, newCoverLetter, newVersion);

      // Regenerate PDFs
      let pdfInfo = '';
      try {
        const { pdfPath, fullPackagePath } = await generateApplicationPackage(job, newCoverLetter, cv);
        updateApplicationPdfPaths(existingApp.id, pdfPath, fullPackagePath);
        pdfInfo = '\n📎 PDFs aktualisiert';
      } catch (err) {
        logger.error('PDF regeneration failed', { error: err });
        pdfInfo = '\n⚠️ PDF Aktualisierung fehlgeschlagen';
      }

      logActivity(job.id, existingApp.id, 'edited', JSON.stringify({
        version: newVersion,
        word_count: wordCount,
        feedback,
      }));

      await ctx.reply(
        `✅ Anschreiben ueberarbeitet (v${newVersion}) — ${wordCount} Woerter${pdfInfo}\n\nNutze /preview ${jobId} zum Ansehen.`,
        getKeyboardForMethod(job.id, job.application_method)
      );
    } catch (err) {
      logger.error('Error in /edit command', { error: err });
      ctx.reply('Fehler beim Ueberarbeiten des Anschreibens.');
    }
  });

  // Callback: Edit (prompts user to use /edit command)
  bot.action(/^edit_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply(`Zum Bearbeiten: /edit ${jobId} <dein Feedback>\n\nBeispiel: /edit ${jobId} Mehr Fokus auf Teamfuehrung`);
  });
}
