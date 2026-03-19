import type { Browser } from 'puppeteer';
import { BaseScraper, type ScrapedJob, getRandomUserAgent, getRandomViewport } from './base-scraper.js';
import { logger } from '../utils/logger.js';
import { getJobBySourceId } from '../db/queries.js';

export class IndeedScraper extends BaseScraper {
  readonly name = 'Indeed';
  readonly source = 'indeed' as const;

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
      const vp = getRandomViewport();
      await page.setViewport({ width: vp.width, height: vp.height });

      for (const keyword of keywords) {
        if (jobs.length >= maxJobs) break;

        const searchUrl = `https://ch.indeed.com/jobs?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}&fromage=1`;
        logger.info(`Indeed: searching "${keyword}" in ${location}`);

        const navigated = await this.safeGoto(page, searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        if (!navigated) continue;

        await this.delay(4000, 8000);

        // Check for CAPTCHA or block
        const pageContent = await page.content();
        if (pageContent.includes('captcha') || pageContent.includes('blocked')) {
          logger.warn('Indeed: CAPTCHA or block detected, skipping');
          continue;
        }

        // Parse job cards from search results
        const jobCards = await page.$$eval(
          '.job_seen_beacon, .jobsearch-ResultsList .result, [data-jk]',
          (cards) =>
            cards.map((card) => {
              const titleEl = card.querySelector('h2.jobTitle a, .jobTitle a, a[data-jk]');
              const companyEl = card.querySelector('[data-testid="company-name"], .companyName, .company');
              const locationEl = card.querySelector('[data-testid="text-location"], .companyLocation, .location');
              const linkEl = card.querySelector('a[data-jk], h2.jobTitle a, .jobTitle a');
              const salaryEl = card.querySelector('.salary-snippet-container, .estimated-salary, [data-testid="attribute_snippet_testid"]');

              const href = linkEl?.getAttribute('href') || '';
              const jk = linkEl?.getAttribute('data-jk') || card.getAttribute('data-jk') || '';

              return {
                title: titleEl?.textContent?.trim() || '',
                company: companyEl?.textContent?.trim() || '',
                location: locationEl?.textContent?.trim() || '',
                href,
                sourceId: jk,
                salary: salaryEl?.textContent?.trim() || '',
              };
            })
        );

        logger.info(`Indeed: found ${jobCards.length} job cards for "${keyword}"`);

        for (const card of jobCards) {
          if (jobs.length >= maxJobs) break;
          if (!card.title || !card.company || !card.sourceId) continue;

          // Check for existing job in DB
          const existing = getJobBySourceId('indeed', card.sourceId);
          if (existing) {
            logger.debug(`Indeed: skipping existing job ${card.sourceId}`);
            continue;
          }

          // Navigate to detail page
          const detailUrl = card.href.startsWith('http')
            ? card.href
            : `https://ch.indeed.com${card.href}`;

          await this.delay(4000, 8000);

          const detailNavigated = await this.safeGoto(page, detailUrl, {
            waitUntil: 'domcontentloaded',
          });
          if (!detailNavigated) continue;

          await this.delay(3000, 6000);

          // Extract full description
          const description = await this.getTextContent(
            page,
            '#jobDescriptionText, .jobsearch-jobDescriptionText, [id="jobDescriptionText"]'
          );

          // Detect application method
          const applyButtonExists = await page.$('.jobsearch-IndeedApplyButton, [data-testid="indeedApplyButton"]');
          const externalApplyButton = await page.$('.jobsearch-IndeedApplyButton-newWindow, [data-testid="applyButton-externalLink"]');

          let applicationUrl: string | undefined;
          if (externalApplyButton) {
            applicationUrl = await page.$eval(
              '.jobsearch-IndeedApplyButton-newWindow a, [data-testid="applyButton-externalLink"] a',
              (el) => el.getAttribute('href') || ''
            ).catch(() => undefined);
          }

          const { method, url, email } = this.detectApplicationMethod(
            description || '',
            !!applyButtonExists || !!externalApplyButton,
            applicationUrl || detailUrl
          );

          const job: ScrapedJob = {
            sourceId: card.sourceId,
            source: 'indeed',
            title: card.title,
            company: card.company,
            location: card.location,
            description: description || '',
            salaryRange: card.salary || undefined,
            sourceUrl: detailUrl,
            applicationMethod: method,
            applicationUrl: url,
            applicationEmail: email,
          };

          jobs.push(job);
          logger.info(`Indeed: scraped "${job.title}" at ${job.company}`);
        }
      }
    } catch (err) {
      logger.error('Indeed scraper error', { error: err });
    } finally {
      await page.close();
    }

    return jobs;
  }
}
