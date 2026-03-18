import type { Telegraf } from 'telegraf';
import { getNewJobs, getJobById, updateJobStatus, logActivity, getActivityForJob } from '../../db/queries.js';
import { jobListKeyboard } from '../keyboards.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { testTag } from '../../utils/test-mode.js';

function formatJobCard(job: ReturnType<typeof getJobById>, index?: number): string {
  if (!job) return '';
  const tag = testTag();

  const score = job.match_score ?? 0;
  const prefix = index !== undefined ? `${tag}🎯 Job #${index + 1} — Match: ${score}%` : `${tag}🎯 Match: ${score}%`;

  // Salary formatting
  let salaryLine = '💰 Nicht geschaetzt';
  if (job.salary_estimate_min && job.salary_estimate_max && job.salary_estimate_realistic) {
    const currency = job.salary_currency || 'CHF';
    salaryLine = `💰 ${currency} ${formatNum(job.salary_estimate_min)} – ${formatNum(job.salary_estimate_max)} (realistisch: ~${formatNum(job.salary_estimate_realistic)})`;
  } else if (job.salary_range) {
    salaryLine = `💰 ${job.salary_range}`;
  }

  // Application method
  const methodMap: Record<string, string> = {
    portal: '📝 Portal Bewerbung',
    email: '📧 Mail Bewerbung',
    both: '📝📧 Portal + Mail',
  };
  const methodLine = methodMap[job.application_method || ''] || '📝 Bewerbung';

  // Matching skills from activity log
  let skillsLines = '';
  const matchDetails = getActivityForJob(job.id, 'matched');
  if (matchDetails) {
    try {
      const details = JSON.parse(matchDetails);
      if (details.matching_skills?.length) {
        skillsLines += `\n⭐ Match: ${details.matching_skills.slice(0, 4).join(', ')}`;
      }
      if (details.missing_skills?.length) {
        skillsLines += `\n⚠️ Gap: ${details.missing_skills.slice(0, 3).join(', ')}`;
      }
    } catch { /* ignore */ }
  }

  return `${prefix}\n\n📌 ${job.title}\n🏢 ${job.company}\n📍 ${job.location || 'Nicht angegeben'}\n${salaryLine}\n${methodLine}${skillsLines}`;
}

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

export function registerJobsHandlers(bot: Telegraf): void {
  // /jobs command
  bot.command('jobs', async (ctx) => {
    try {
      const jobs = getNewJobs(10);

      if (jobs.length === 0) {
        return ctx.reply('Keine neuen Jobs vorhanden. Warte auf den naechsten Scraper Lauf oder starte manuell mit /scrape.');
      }

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const card = formatJobCard(job, i);
        await ctx.reply(card, jobListKeyboard(job.id));
      }
    } catch (err) {
      logger.error('Error in /jobs command', { error: err });
      ctx.reply('Fehler beim Laden der Jobs.');
    }
  });

  // Callback: Details
  bot.action(/^details_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const job = getJobById(jobId);

    if (!job) {
      return ctx.answerCbQuery('Job nicht gefunden');
    }

    await ctx.answerCbQuery();

    const desc = job.description
      ? job.description.substring(0, 3500)
      : 'Keine Beschreibung verfuegbar';

    let text = `📋 Details: ${job.title}\n🏢 ${job.company}\n\n${desc}`;

    if (job.source_url) {
      text += `\n\n🔗 ${job.source_url}`;
    }

    await ctx.reply(text);
  });

  // Callback: Skip
  bot.action(/^skip_(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const job = getJobById(jobId);

    if (!job) {
      return ctx.answerCbQuery('Job nicht gefunden');
    }

    updateJobStatus(jobId, 'reviewed');
    logActivity(jobId, null, 'status_changed', JSON.stringify({ from: job.status, to: 'reviewed' }));
    await ctx.answerCbQuery('Job uebersprungen');
    await ctx.editMessageReplyMarkup(undefined);
  });
}

export { formatJobCard, formatNum };
