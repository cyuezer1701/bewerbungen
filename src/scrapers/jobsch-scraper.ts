import type { Browser } from 'puppeteer';
import { BaseScraper, type ScrapedJob, getRandomUserAgent } from './base-scraper.js';
import { logger } from '../utils/logger.js';
import { getJobBySourceId } from '../db/queries.js';

export class JobsChScraper extends BaseScraper {
  readonly name = 'jobs.ch';
  readonly source = 'jobsch' as const;

  async scrape(
    keywords: string[],
    location: string,
    browser: Browser,
    maxJobs: number
  ): Promise<ScrapedJob[]> {
    const jobs: ScrapedJob[] = [];
    const page = await browser.newPage();

    try {
      await page.setUserAgent(getRandomUserAgent());
      await page.setViewport({ width: 1920, height: 1080 });

      // Split multi-location into separate searches
      const locations = location.includes(',')
        ? location.split(',').map((l) => l.trim()).filter(Boolean)
        : [location];

      for (const loc of locations) {
        for (const keyword of keywords) {
          if (jobs.length >= maxJobs) break;

          const searchUrl = `https://www.jobs.ch/en/vacancies/?term=${encodeURIComponent(keyword)}&location=${encodeURIComponent(loc)}`;
          logger.info(`jobs.ch: searching "${keyword}" in ${loc}`);

          const navigated = await this.safeGoto(page, searchUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000,
          });
          if (!navigated) continue;

          await this.delay(2000, 4000);

          // Handle cookie consent if present
          const cookieButton = await page.$('[data-testid="uc-accept-all-button"], #onetrust-accept-btn-handler, button[id*="cookie"], button[id*="consent"]');
          if (cookieButton) {
            await cookieButton.click().catch(() => {});
            await this.delay(1000, 2000);
          }

          // Parse job cards using data-cy="serp-item" and data-cy="job-link"
          const jobCards = await page.$$eval(
            '[data-cy="serp-item"], li:has(a[data-cy="job-link"])',
            (cards) =>
              cards.map((card) => {
                // Find the job link
                const linkEl = card.querySelector('a[data-cy="job-link"]') as HTMLAnchorElement | null;
                if (!linkEl) return null;

                const href = linkEl.getAttribute('href') || '';
                const title = linkEl.getAttribute('title') || linkEl.textContent?.trim() || '';

                // Extract source ID from URL (UUID format)
                const sourceId = href.match(/detail\/([a-f0-9-]+)/)?.[1] || '';

                // Extract text content for company and location
                const fullText = card.textContent || '';

                // Company is usually after the title, before "Is this job relevant"
                // Pattern: "TitlePlace of work:LocationWorkload:...Company"
                const placeMatch = fullText.match(/Place of work:\s*([^\n]+?)(?:Workload|Contract|$)/);
                const location = placeMatch ? placeMatch[1].trim() : '';

                // Company name - try to find it between workload/contract info and "Is this job"
                // It's typically the last distinct text before the "Is this job relevant" button
                const companyMatch = fullText.match(/(?:Permanent position|Temporary|Contract type:[^\n]+?)\s+(.+?)(?:Easy apply|Is this job)/);
                const company = companyMatch ? companyMatch[1].trim() : '';

                return { title, company, location, href, sourceId };
              }).filter((c): c is NonNullable<typeof c> => c !== null && c.sourceId !== '')
          );

          logger.info(`jobs.ch: found ${jobCards.length} job cards for "${keyword}" in ${loc}`);

          for (const card of jobCards) {
            if (jobs.length >= maxJobs) break;
            if (!card.title || !card.sourceId) continue;

            // Check for existing job in DB
            const existing = getJobBySourceId('jobsch', card.sourceId);
            if (existing) {
              logger.debug(`jobs.ch: skipping existing job ${card.sourceId}`);
              continue;
            }

            await this.delay(2000, 4000);

            // Navigate to detail page
            const detailUrl = card.href.startsWith('http')
              ? card.href
              : `https://www.jobs.ch${card.href}`;

            const detailNavigated = await this.safeGoto(page, detailUrl, {
              waitUntil: 'networkidle2',
              timeout: 30000,
            });
            if (!detailNavigated) continue;

            await this.delay(1000, 2000);

            // Extract full description from detail page
            const description = await page.evaluate(() => {
              // Try multiple selectors for the job description
              const selectors = [
                '[data-cy="vacancy-description"]',
                '[class*="description"]',
                'article',
                'main section',
              ];
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent && el.textContent.trim().length > 100) {
                  return el.textContent.trim();
                }
              }
              return document.querySelector('main')?.textContent?.trim() || '';
            });

            // Extract company name from detail page if missing
            const company = card.company || await page.evaluate(() => {
              const el = document.querySelector('[data-cy="company-name"], [class*="company"]');
              return el?.textContent?.trim() || '';
            }) || 'Unbekannt';

            // Extract location from detail page if missing
            const jobLocation = card.location || await page.evaluate(() => {
              const el = document.querySelector('[data-cy="info-location"], [class*="location"]');
              return el?.textContent?.trim() || '';
            });

            // Detect application method
            const applyButton = await page.$('a[data-cy="apply-button"], button[data-cy="apply-button"], a[href*="apply"]');
            let applicationUrl: string | undefined;

            if (applyButton) {
              applicationUrl = await page.$eval(
                'a[data-cy="apply-button"], a[href*="apply"]',
                (el) => el.getAttribute('href') || ''
              ).catch(() => undefined);

              if (applicationUrl && !applicationUrl.startsWith('http')) {
                applicationUrl = `https://www.jobs.ch${applicationUrl}`;
              }
            }

            const { method, url, email } = this.detectApplicationMethod(
              description || '',
              !!applyButton,
              applicationUrl || detailUrl
            );

            const contactInfo = this.extractContactInfo(description || '');
            const referenceNumber = this.extractReferenceNumber(description || '');
            const salaryRequestedInPosting = this.detectSalaryRequested(description || '');

            const job: ScrapedJob = {
              sourceId: card.sourceId,
              source: 'jobsch',
              title: card.title,
              company,
              location: jobLocation,
              description: description.substring(0, 5000),
              sourceUrl: detailUrl,
              applicationMethod: method,
              applicationUrl: url,
              applicationEmail: email,
              ...contactInfo,
              referenceNumber,
              salaryRequestedInPosting,
            };

            jobs.push(job);
            logger.info(`jobs.ch: scraped "${job.title}" at ${job.company} (${jobLocation})`);
          }
        }
      }
    } catch (err) {
      logger.error('jobs.ch scraper error', { error: err });
    } finally {
      await page.close();
    }

    return jobs;
  }
}
