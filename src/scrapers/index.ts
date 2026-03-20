import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { alertScraperError } from '../utils/alerter.js';
import { getSetting } from '../db/settings.js';
import { insertJob, logActivity, normalizeCompany } from '../db/queries.js';
import { type ScrapedJob, launchStealthBrowser } from './base-scraper.js';
import { JobsChScraper } from './jobsch-scraper.js';
import { runJobSpy } from './jobspy-scraper.js';
import type { BaseScraper } from './base-scraper.js';

// --- Global Scrape Lock ---

let scrapeRunning = false;

export function isScrapeRunning(): boolean {
  return scrapeRunning;
}

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
    logger.info(`Deduplication: removed ${removed} duplicates`);
  }

  return unique;
}

// --- Scraper Orchestrator ---

export async function runScrapers(): Promise<ScrapedJob[]> {
  if (scrapeRunning) {
    logger.warn('Scraper already running, skipping');
    return [];
  }
  scrapeRunning = true;

  try {
  logger.info('Starting scraper run...');

  // Only jobs.ch scraper
  const scrapers: BaseScraper[] = [];
  if (getSetting('scraper_jobsch_enabled') !== 'false') scrapers.push(new JobsChScraper());

  if (scrapers.length === 0) {
    logger.warn('No scrapers enabled');
    return [];
  }

  // Collect keywords from search strategy (AI profile + manual)
  const { getSearchKeywords } = await import('../matching/search-strategy.js');
  const { keywords: allKeywords, source: keywordSource } = getSearchKeywords();
  const location = getSetting('search_location') || config.JOB_SEARCH_LOCATION;

  logger.info(`Scraping with keywords (${keywordSource}): ${allKeywords.join(', ')}`);
  logger.info(`Location: ${location}`);

  let browser;
  const allJobs: ScrapedJob[] = [];

  try {
    browser = await launchStealthBrowser();

    // Run scrapers sequentially (share browser, reduce detection risk)
    // Global job limit shared across all scrapers
    const globalMax = parseInt(getSetting('max_jobs_per_day') || '', 10) || config.MAX_JOBS_PER_DAY;
    for (const scraper of scrapers) {
      if (allJobs.length >= globalMax) {
        logger.info(`Global job limit (${globalMax}) reached, skipping ${scraper.name}`);
        break;
      }
      try {
        const remaining = globalMax - allJobs.length;
        logger.info(`Running ${scraper.name} scraper... (${remaining} slots remaining)`);
        const jobs = await scraper.scrape(
          allKeywords,
          location,
          browser,
          remaining
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

  // JobSpy: additional sources (Indeed, Glassdoor, Google)
  if (getSetting('scraper_jobspy_enabled') !== 'false') {
    try {
      const globalMax = parseInt(getSetting('max_jobs_per_day') || '', 10) || config.MAX_JOBS_PER_DAY;
      const remaining = Math.max(0, globalMax - allJobs.length);
      if (remaining > 0) {
        const jobspyJobs = await runJobSpy(allKeywords.slice(0, 5), location, remaining);
        allJobs.push(...jobspyJobs);
      }
    } catch (err) {
      logger.error('JobSpy scraper failed', { error: err });
      await alertScraperError('JobSpy', err);
    }
  }

  // Cross-source deduplication
  const uniqueJobs = deduplicateJobs(allJobs);

  // Exclude-Keywords filtering
  const { getExcludeKeywords } = await import('../matching/search-strategy.js');
  const excludeFromProfile = getExcludeKeywords();
  const excludeFromSettings = (getSetting('exclude_keywords') || '').split(',').map(k => k.trim()).filter(Boolean);
  const allExcludeKeywords = [...new Set([...excludeFromProfile, ...excludeFromSettings])].map(k => k.toLowerCase());

  let filteredJobs = uniqueJobs;
  let excludedCount = 0;
  if (allExcludeKeywords.length > 0) {
    filteredJobs = uniqueJobs.filter(job => {
      const titleLower = job.title.toLowerCase();
      const descLower = (job.description || '').toLowerCase();
      const match = allExcludeKeywords.find(kw => titleLower.includes(kw) || descLower.includes(kw));
      if (match) {
        logger.debug(`Exclude-Keyword "${match}" matched: "${job.title}" at ${job.company}`);
        excludedCount++;
        return false;
      }
      return true;
    });
    if (excludedCount > 0) {
      logger.info(`Exclude-Keywords filter: removed ${excludedCount} jobs (keywords: ${allExcludeKeywords.join(', ')})`);
    }
  }

  // Save to database
  let savedCount = 0;
  for (const job of filteredJobs) {
    try {
      const id = uuidv4();
      const companyNormalized = normalizeCompany(job.company);
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
        contact_person: job.contactPerson,
        contact_gender: job.contactGender,
        contact_title: job.contactTitle,
        contact_department: job.contactDepartment,
        reference_number: job.referenceNumber,
        salary_requested_in_posting: job.salaryRequestedInPosting,
        company_normalized: companyNormalized,
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

  logger.info(`Scraper run complete: ${allJobs.length} found, ${uniqueJobs.length} unique, ${excludedCount} excluded by keywords, ${savedCount} saved to DB`);

  return filteredJobs;
  } finally {
    scrapeRunning = false;
  }
}
