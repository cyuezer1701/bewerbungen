import type { Browser } from 'puppeteer';
import { BaseScraper, type ScrapedJob, getRandomUserAgent, getRandomViewport } from './base-scraper.js';
import { logger } from '../utils/logger.js';
import { getJobBySourceId } from '../db/queries.js';

export class LinkedInScraper extends BaseScraper {
  readonly name = 'LinkedIn';
  readonly source = 'linkedin' as const;

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

        const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&f_TPR=r86400`;
        logger.info(`LinkedIn: searching "${keyword}" in ${location}`);

        const navigated = await this.safeGoto(page, searchUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        if (!navigated) continue;

        await this.delay(4000, 8000);

        // Check for CAPTCHA or auth wall
        const pageUrl = page.url();
        const pageContent = await page.content();
        if (
          pageUrl.includes('/authwall') ||
          pageUrl.includes('/checkpoint') ||
          pageContent.includes('captcha') ||
          pageContent.includes('Sign in')
        ) {
          logger.warn('LinkedIn: auth wall or CAPTCHA detected, skipping');
          continue;
        }

        // Scroll to load more jobs (3-5 times) with random mouse moves
        const scrollCount = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < scrollCount; i++) {
          // Random mouse move before scrolling to appear more human
          await page.mouse.move(
            200 + Math.floor(Math.random() * 800),
            200 + Math.floor(Math.random() * 400)
          );
          await this.delay(500, 1500);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await this.delay(3000, 5000);

          // Click "See more jobs" button if present
          const seeMoreButton = await page.$('.infinite-scroller__show-more-button, button[aria-label="See more jobs"]');
          if (seeMoreButton) {
            await seeMoreButton.click().catch(() => {});
            await this.delay(2000, 4000);
          }
        }

        // Parse job cards
        const jobCards = await page.$$eval(
          '.jobs-search__results-list li, .base-card, [data-entity-urn]',
          (cards) =>
            cards.map((card) => {
              const titleEl = card.querySelector('.base-search-card__title, h3.base-search-card__title');
              const companyEl = card.querySelector('.base-search-card__subtitle, h4.base-search-card__subtitle');
              const locationEl = card.querySelector('.job-search-card__location');
              const linkEl = card.querySelector('a.base-card__full-link, a[data-tracking-control-name]');
              const dateEl = card.querySelector('time');

              const href = linkEl?.getAttribute('href') || '';
              // Extract job ID from URL or data attribute
              const urn = card.getAttribute('data-entity-urn') || '';
              const sourceId = urn.match(/(\d+)/)?.[1] || href.match(/view\/[^/]*?-(\d+)/)?.[1] || '';

              return {
                title: titleEl?.textContent?.trim() || '',
                company: companyEl?.textContent?.trim() || '',
                location: locationEl?.textContent?.trim() || '',
                href,
                sourceId,
                postedAt: dateEl?.getAttribute('datetime') || '',
              };
            })
        );

        logger.info(`LinkedIn: found ${jobCards.length} job cards for "${keyword}"`);

        for (const card of jobCards) {
          if (jobs.length >= maxJobs) break;
          if (!card.title || !card.company || !card.sourceId) continue;

          // Check for existing job in DB
          const existing = getJobBySourceId('linkedin', card.sourceId);
          if (existing) {
            logger.debug(`LinkedIn: skipping existing job ${card.sourceId}`);
            continue;
          }

          // Random delay between detail page visits
          await this.delay(4000, 8000);

          // Navigate to detail page
          const detailUrl = card.href.startsWith('http')
            ? card.href
            : `https://www.linkedin.com${card.href}`;

          const detailNavigated = await this.safeGoto(page, detailUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          if (!detailNavigated) continue;

          await this.delay(3000, 6000);

          // Check for auth wall on detail page
          if (page.url().includes('/authwall') || page.url().includes('/login')) {
            logger.warn('LinkedIn: auth wall on detail page, skipping');
            continue;
          }

          // Extract description
          const description = await this.getTextContent(
            page,
            '.description__text .show-more-less-html__markup, .show-more-less-html__markup, .description__text'
          );

          // Detect application method
          const easyApplyButton = await page.$('.jobs-apply-button--top-card, [data-control-name="jobdetails_topcard_inapply"]');
          const externalApplyLink = await page.$('a.jobs-apply-button[href*="externalApply"], a[data-tracking-control-name="public_jobs_apply-link-offsite"]');

          let applicationUrl: string | undefined;
          if (externalApplyLink) {
            applicationUrl = await page.$eval(
              'a.jobs-apply-button[href*="externalApply"], a[data-tracking-control-name="public_jobs_apply-link-offsite"]',
              (el) => el.getAttribute('href') || ''
            ).catch(() => undefined);
          }

          const { method, url, email } = this.detectApplicationMethod(
            description || '',
            !!easyApplyButton || !!externalApplyLink,
            applicationUrl || detailUrl
          );

          const job: ScrapedJob = {
            sourceId: card.sourceId,
            source: 'linkedin',
            title: card.title,
            company: card.company,
            location: card.location,
            description: description || '',
            sourceUrl: detailUrl,
            postedAt: card.postedAt || undefined,
            applicationMethod: method,
            applicationUrl: url || detailUrl,
            applicationEmail: email,
          };

          jobs.push(job);
          logger.info(`LinkedIn: scraped "${job.title}" at ${job.company}`);
        }
      }
    } catch (err) {
      logger.error('LinkedIn scraper error', { error: err });
    } finally {
      await page.close();
    }

    return jobs;
  }
}
