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

      for (const keyword of keywords) {
        if (jobs.length >= maxJobs) break;

        const searchUrl = `https://www.jobs.ch/en/vacancies/?term=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`;
        logger.info(`jobs.ch: searching "${keyword}" in ${location}`);

        const navigated = await this.safeGoto(page, searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        if (!navigated) continue;

        await this.delay(2000, 4000);

        // Handle cookie consent if present
        const cookieButton = await page.$('[data-testid="uc-accept-all-button"], #onetrust-accept-btn-handler, .cookie-consent-accept');
        if (cookieButton) {
          await cookieButton.click().catch(() => {});
          await this.delay(1000, 2000);
        }

        // Parse job cards
        const jobCards = await page.$$eval(
          '[data-cy="vacancy-item"], .vacancy-item, article[class*="vacancy"], a[href*="/en/vacancies/detail/"]',
          (cards) =>
            cards.map((card) => {
              const titleEl = card.querySelector('h2, h3, [data-cy="vacancy-title"], [class*="title"]');
              const companyEl = card.querySelector('[data-cy="vacancy-company"], [class*="company"]');
              const locationEl = card.querySelector('[data-cy="vacancy-location"], [class*="location"]');

              // Get link - either the card itself is an anchor, or find one inside
              const linkEl = card.tagName === 'A'
                ? card as HTMLAnchorElement
                : card.querySelector('a[href*="/en/vacancies/detail/"], a[href*="/vacancies/"]');
              const href = linkEl?.getAttribute('href') || '';

              // Extract source ID from URL
              const sourceId = href.match(/detail\/([a-zA-Z0-9-]+)/)?.[1] ||
                href.match(/vacancies\/([a-zA-Z0-9-]+)/)?.[1] || '';

              return {
                title: titleEl?.textContent?.trim() || '',
                company: companyEl?.textContent?.trim() || '',
                location: locationEl?.textContent?.trim() || '',
                href,
                sourceId,
              };
            })
        );

        logger.info(`jobs.ch: found ${jobCards.length} job cards for "${keyword}"`);

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
            waitUntil: 'domcontentloaded',
          });
          if (!detailNavigated) continue;

          await this.delay(1000, 2000);

          // Extract full description
          const description = await this.getTextContent(
            page,
            '[data-cy="vacancy-description"], .vacancy-description, [class*="description"], article'
          );

          // Extract company name from detail if missing
          const company = card.company || await this.getTextContent(
            page,
            '[data-cy="vacancy-company"], [class*="company-name"]'
          );

          // Detect application method
          // jobs.ch: Look for "Online bewerben" / "Apply online" button or email
          const applyButton = await page.$('a[href*="apply"], button[data-cy="apply-button"], [class*="apply"]');
          let applicationUrl: string | undefined;

          if (applyButton) {
            applicationUrl = await page.$eval(
              'a[href*="apply"], a[class*="apply"]',
              (el) => el.getAttribute('href') || ''
            ).catch(() => undefined);

            // If it's a relative URL, make it absolute
            if (applicationUrl && !applicationUrl.startsWith('http')) {
              applicationUrl = `https://www.jobs.ch${applicationUrl}`;
            }
          }

          const { method, url, email } = this.detectApplicationMethod(
            description || '',
            !!applyButton,
            applicationUrl || detailUrl
          );

          const job: ScrapedJob = {
            sourceId: card.sourceId,
            source: 'jobsch',
            title: card.title,
            company: company || 'Unbekannt',
            location: card.location,
            description: description || '',
            sourceUrl: detailUrl,
            applicationMethod: method,
            applicationUrl: url,
            applicationEmail: email,
          };

          jobs.push(job);
          logger.info(`jobs.ch: scraped "${job.title}" at ${job.company}`);
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
