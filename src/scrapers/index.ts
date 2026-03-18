import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { alertScraperError } from '../utils/alerter.js';
import { getSetting } from '../db/settings.js';
import { insertJob, getActiveSearchProfiles, logActivity } from '../db/queries.js';
import { type ScrapedJob, launchStealthBrowser } from './base-scraper.js';
import { IndeedScraper } from './indeed-scraper.js';
import { LinkedInScraper } from './linkedin-scraper.js';
import { JobsChScraper } from './jobsch-scraper.js';
import type { BaseScraper } from './base-scraper.js';

// --- Levenshtein Distance ---

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function normalizeForComparison(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
}

// --- Cross-source Deduplication ---

function deduplicateJobs(jobs: ScrapedJob[]): ScrapedJob[] {
  const unique: ScrapedJob[] = [];

  for (const job of jobs) {
    const jobKey = normalizeForComparison(`${job.title} ${job.company}`);

    const isDuplicate = unique.some((existing) => {
      // Only dedup across different sources
      if (existing.source === job.source) return false;

      const existingKey = normalizeForComparison(`${existing.title} ${existing.company}`);
      return levenshteinSimilarity(jobKey, existingKey) > 0.85;
    });

    if (isDuplicate) {
      logger.debug(`Dedup: skipping duplicate "${job.title}" at ${job.company} (${job.source})`);
    } else {
      unique.push(job);
    }
  }

  const removed = jobs.length - unique.length;
  if (removed > 0) {
    logger.info(`Deduplication: removed ${removed} cross-source duplicates`);
  }

  return unique;
}

// --- Scraper Orchestrator ---

export async function runScrapers(): Promise<ScrapedJob[]> {
  logger.info('Starting scraper run...');

  const scrapers: BaseScraper[] = [
    new IndeedScraper(),
    new LinkedInScraper(),
    new JobsChScraper(),
  ];

  // Collect keywords from settings DB (fallback to config)
  const settingsKeywords = getSetting('search_keywords');
  const defaultKeywords = (settingsKeywords || config.JOB_SEARCH_KEYWORDS).split(',').map((k) => k.trim());
  const profiles = getActiveSearchProfiles();
  const profileKeywords = profiles.flatMap((p) => p.keywords.split(',').map((k) => k.trim()));
  const allKeywords = [...new Set([...defaultKeywords, ...profileKeywords])];
  const location = getSetting('search_location') || config.JOB_SEARCH_LOCATION;

  logger.info(`Scraping with keywords: ${allKeywords.join(', ')}`);
  logger.info(`Location: ${location}`);

  let browser;
  const allJobs: ScrapedJob[] = [];

  try {
    browser = await launchStealthBrowser();

    // Run scrapers sequentially (share browser, reduce detection risk)
    for (const scraper of scrapers) {
      try {
        logger.info(`Running ${scraper.name} scraper...`);
        const jobs = await scraper.scrape(
          allKeywords,
          location,
          browser,
          config.MAX_JOBS_PER_DAY
        );
        allJobs.push(...jobs);
        logger.info(`${scraper.name}: found ${jobs.length} jobs`);
      } catch (err) {
        logger.error(`${scraper.name} scraper failed`, { error: err });
        await alertScraperError(scraper.name, err);
      }
    }
  } finally {
    if (browser) {
      await browser.close();
      logger.info('Browser closed');
    }
  }

  // Cross-source deduplication
  const uniqueJobs = deduplicateJobs(allJobs);

  // Save to database
  let savedCount = 0;
  for (const job of uniqueJobs) {
    try {
      const id = uuidv4();
      insertJob({
        id,
        source: job.source,
        source_id: job.sourceId,
        source_url: job.sourceUrl,
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
        salary_range: job.salaryRange,
        application_method: job.applicationMethod,
        application_url: job.applicationUrl,
        application_email: job.applicationEmail,
        posted_at: job.postedAt,
      });
      logActivity(id, null, 'scraped', JSON.stringify({
        source: job.source,
        title: job.title,
        company: job.company,
      }));
      savedCount++;
    } catch (err) {
      logger.error(`Failed to save job "${job.title}" at ${job.company}`, { error: err });
    }
  }

  logger.info(`Scraper run complete: ${allJobs.length} found, ${uniqueJobs.length} unique, ${savedCount} saved to DB`);

  return uniqueJobs;
}
