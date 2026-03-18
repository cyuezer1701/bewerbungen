import type { Telegraf } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retry.js';
import {
  getJobById,
  insertApplication,
  getApplicationByJobId,
  updateJobStatus,
  logActivity,
  getActivityForJob,
} from '../../db/queries.js';
import { getStructuredCV } from '../../matching/cv-parser.js';
import {
  afterGeneratePortalKeyboard,
  afterGenerateEmailKeyboard,
  afterGenerateBothKeyboard,
} from '../keyboards.js';

const COVER_LETTER_PROMPT = `Du bist ein erfahrener Bewerbungscoach fuer den DACH-Markt (Schweiz/Deutschland/Oesterreich).
Schreibe ein professionelles, individuelles Bewerbungsschreiben.

REGELN:
- Sprache: Deutsch (Schweizer Stil, kein ß, kein Genitiv-s wo unueblich)
- Kein generischer Floskeln ("mit grossem Interesse habe ich...")
- Direkt, selbstbewusst, konkret
- Bezug auf spezifische Anforderungen aus der Stellenbeschreibung
- Erwaehne 2-3 konkrete Erfolge/Projekte aus dem CV die relevant sind
- Laenge: ca. 250-350 Woerter
- Keine Emojis, keine Aufzaehlungszeichen im Fliesstext
- KEINE Bindestriche verwenden, sie wirken maschinell
- Format: Absender, Datum, Empfaenger, Betreff, Anrede, 3-4 Absaetze, Gruss

KANDIDAT:
{cv}

JOB:
Titel: {title}
Firma: {company}
Ort: {location}
Beschreibung: {description}

FOKUS-EMPFEHLUNG VOM MATCHING:
{focus}

Antwort als reiner Text (kein Markdown), bereit fuer PDF-Generierung.`;

async function generateCoverLetter(
  job: NonNullable<ReturnType<typeof getJobById>>,
  feedback?: string
): Promise<string> {
  const cv = await getStructuredCV();

  // Get cover_letter_focus from matching activity
  let focus = 'Allgemeine Passung hervorheben';
  const matchDetails = getActivityForJob(job.id, 'matched');
  if (matchDetails) {
    try {
      const details = JSON.parse(matchDetails);
      if (details.cover_letter_focus) {
        focus = details.cover_letter_focus;
      }
    } catch { /* ignore */ }
  }

  let prompt = COVER_LETTER_PROMPT
    .replace('{cv}', JSON.stringify(cv, null, 2))
    .replace('{title}', job.title)
    .replace('{company}', job.company)
    .replace('{location}', job.location || 'nicht angegeben')
    .replace('{description}', job.description || 'keine Beschreibung')
    .replace('{focus}', focus);

  if (feedback) {
    prompt += `\n\nZUSAETZLICHES FEEDBACK VOM BEWERBER:\n${feedback}\n\nBitte beruecksichtige dieses Feedback bei der Ueberarbeitung.`;
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  return withRetry(async () => {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude API');
    }

    return textBlock.text;
  });
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

export function registerApplyHandlers(bot: Telegraf): void {
  // /apply <id> command
  bot.command('apply', async (ctx) => {
    const jobId = ctx.message.text.split(/\s+/)[1];
    if (!jobId) {
      return ctx.reply('Usage: /apply <job-id>');
    }

    const job = getJobById(jobId);
    if (!job) {
      return ctx.reply(`Job "${jobId}" nicht gefunden.`);
    }

    try {
      await ctx.reply(`📄 Anschreiben fuer "${job.title}" @ ${job.company} wird generiert...`);

      const coverLetter = await generateCoverLetter(job);
      const wordCount = coverLetter.split(/\s+/).length;

      // Save application
      const appId = uuidv4();
      insertApplication({
        id: appId,
        job_id: job.id,
        cover_letter_text: coverLetter,
      });

      updateJobStatus(job.id, 'applying');
      logActivity(job.id, appId, 'generated', JSON.stringify({ version: 1, word_count: wordCount }));

      // Build confirmation message
      let msg = `✅ Bewerbung ready!\n📌 ${job.title} @ ${job.company}\n`;
      if (job.salary_estimate_realistic) {
        msg += `💰 ~${job.salary_currency || 'CHF'} ${formatNum(job.salary_estimate_realistic)}\n`;
      }
      if (job.application_method === 'email' || job.application_method === 'both') {
        if (job.application_email) msg += `📧 ${job.application_email}\n`;
      }
      if (job.application_method === 'portal' || job.application_method === 'both') {
        if (job.application_url) msg += `🔗 ${job.application_url}\n`;
      }
      msg += `\n📎 Anschreiben (v1) — ${wordCount} Woerter`;

      await ctx.reply(msg, getKeyboardForMethod(job.id, job.application_method));
    } catch (err) {
      logger.error('Error in /apply command', { error: err });
      ctx.reply('Fehler bei der Generierung des Anschreibens.');
    }
  });

  // Callback: Apply (from job list)
  bot.action(/^apply_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    await ctx.answerCbQuery();

    const job = getJobById(jobId);
    if (!job) {
      return ctx.reply('Job nicht gefunden.');
    }

    try {
      await ctx.reply(`📄 Anschreiben fuer "${job.title}" @ ${job.company} wird generiert...`);

      const coverLetter = await generateCoverLetter(job);
      const wordCount = coverLetter.split(/\s+/).length;

      const appId = uuidv4();
      insertApplication({
        id: appId,
        job_id: job.id,
        cover_letter_text: coverLetter,
      });

      updateJobStatus(job.id, 'applying');
      logActivity(job.id, appId, 'generated', JSON.stringify({ version: 1, word_count: wordCount }));

      let msg = `✅ Bewerbung ready!\n📌 ${job.title} @ ${job.company}\n`;
      if (job.salary_estimate_realistic) {
        msg += `💰 ~${job.salary_currency || 'CHF'} ${formatNum(job.salary_estimate_realistic)}\n`;
      }
      if (job.application_email) msg += `📧 ${job.application_email}\n`;
      if (job.application_url) msg += `🔗 ${job.application_url}\n`;
      msg += `\n📎 Anschreiben (v1) — ${wordCount} Woerter`;

      await ctx.reply(msg, getKeyboardForMethod(job.id, job.application_method));
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

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

export { generateCoverLetter };
