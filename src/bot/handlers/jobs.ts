import type { Telegraf } from 'telegraf';
import { getNewJobs, getJobById, updateJobStatus, logActivity, getActivityForJob } from '../../db/queries.js';
import { jobListKeyboard } from '../keyboards.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { testTag } from '../../utils/test-mode.js';

/** Truncate a field and strip scraped junk (jobs.ch sidebar text etc.) */
function cleanField(s: string, maxLen: number): string {
  // Cut at common junk markers from jobs.ch scraping
  const junkMarkers = ['SaveApply', 'Display original ad', 'See company profile', 'About the company', 'Log in, to see'];
  let clean = s;
  for (const marker of junkMarkers) {
    const idx = clean.indexOf(marker);
    if (idx > 0) clean = clean.substring(0, idx);
  }
  clean = clean.trim();
  if (clean.length > maxLen) clean = clean.substring(0, maxLen).trim() + '…';
  return clean;
}

function formatJobCard(job: ReturnType<typeof getJobById>, index?: number): string {
  if (!job) return '';
  const tag = testTag();

  const score = job.match_score ?? 0;
  const prefix = index !== undefined ? `${tag}🎯 Job #${index + 1} — Match: ${score}%` : `${tag}🎯 Match: ${score}%`;

  // Clean title and company from scraped junk
  const title = cleanField(job.title || '', 120);
  const company = cleanField(job.company || '', 80);
  const location = cleanField(job.location || 'Nicht angegeben', 60);

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

  // Recruiter info from activity log (Phase 14)
  let recruiterLines = '';
  if (matchDetails) {
    try {
      const details = JSON.parse(matchDetails);
      if (details.recruiter_verdict) {
        recruiterLines += `\n💬 ${details.recruiter_verdict}`;
      }
      if (details.career_direction) {
        const directionMap: Record<string, string> = {
          aufstieg: '📈 Aufstieg',
          seitwaerts: '↔️ Seitwaerts',
          rueckschritt: '📉 Rueckschritt',
        };
        recruiterLines += `\n${directionMap[details.career_direction] || details.career_direction}`;
      }
      if (details.red_flags?.length) {
        recruiterLines += `\n🚩 ${details.red_flags.slice(0, 2).join(', ')}`;
      }
    } catch { /* ignore */ }
  }

  return `${prefix}\n\n📌 ${title}\n🏢 ${company}\n📍 ${location}\n${salaryLine}\n${methodLine}${skillsLines}${recruiterLines}`;
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
        try {
          const job = jobs[i];
          const card = formatJobCard(job, i);
          await ctx.reply(card, jobListKeyboard(job.id));
        } catch (sendErr) {
          logger.warn(`Failed to send job card #${i + 1}`, { error: sendErr });
        }
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
      ? cleanField(job.description, 3000)
      : 'Keine Beschreibung verfuegbar';

    let text = `📋 Details: ${cleanField(job.title || '', 120)}\n🏢 ${cleanField(job.company || '', 80)}\n\n${desc}`;

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
