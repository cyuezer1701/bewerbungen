import type { Browser } from 'puppeteer';
import { BaseScraper, type ScrapedJob, getRandomUserAgent } from './base-scraper.js';
import { logger } from '../utils/logger.js';
import { getJobBySourceId } from '../db/queries.js';

/**
 * LinkedIn scraper using the public guest jobs API.
 * This endpoint returns HTML fragments without requiring login or cookies.
 * No auth wall, no CAPTCHA — it's the same API the public jobs pages use.
 */
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

      // LinkedIn guest API uses geoId for location — map common Swiss locations
      const geoId = this.getSwissGeoId(location);

      for (const keyword of keywords) {
        if (jobs.length >= maxJobs) break;

        logger.info(`LinkedIn: searching "${keyword}" in ${location}`);

        // Use the guest API endpoint — returns HTML without auth wall
        const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}${geoId ? `&geoId=${geoId}` : ''}&f_TPR=r86400&start=0`;

        const navigated = await this.safeGoto(page, apiUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        if (!navigated) continue;

        await this.delay(2000, 4000);

        // Parse job cards from the guest API HTML response
        const jobCards = await page.$$eval(
          'li',
          (cards) =>
            cards.map((card) => {
              const titleEl = card.querySelector('.base-search-card__title');
              const companyEl = card.querySelector('.base-search-card__subtitle');
              const locationEl = card.querySelector('.job-search-card__location');
              const linkEl = card.querySelector('a.base-card__full-link');
              const dateEl = card.querySelector('time');

              const href = linkEl?.getAttribute('href') || '';
              const urn = card.getAttribute('data-entity-urn') || '';
              const sourceId = urn.match(/(\d+)/)?.[1] || href.match(/(\d+)\?/)?.[1] || href.match(/-(\d+)$/)?.[1] || '';

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

          await this.delay(2000, 5000);

          // Fetch detail page via guest endpoint (no auth required)
          const detailUrl = card.href.startsWith('http')
            ? card.href
            : `https://www.linkedin.com${card.href}`;

          const detailNavigated = await this.safeGoto(page, detailUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          let description = '';
          if (detailNavigated) {
            await this.delay(1500, 3000);

            // Check if we hit auth wall on detail page
            const currentUrl = page.url();
            if (currentUrl.includes('/authwall') || currentUrl.includes('/login')) {
              logger.debug(`LinkedIn: auth wall on detail page for ${card.sourceId}, using title only`);
            } else {
              description = await this.getTextContent(
                page,
                '.show-more-less-html__markup, .description__text, .decorated-job-posting__details'
              );
            }
          }

          const { method, url, email } = this.detectApplicationMethod(
            description,
            true,
            detailUrl
          );

          const contactInfo = this.extractContactInfo(description);
          const referenceNumber = this.extractReferenceNumber(description);
          const salaryRequestedInPosting = this.detectSalaryRequested(description);

          const job: ScrapedJob = {
            sourceId: card.sourceId,
            source: 'linkedin',
            title: card.title,
            company: card.company,
            location: card.location,
            description: description || `${card.title} at ${card.company}`,
            sourceUrl: detailUrl,
            postedAt: card.postedAt || undefined,
            applicationMethod: method,
            applicationUrl: url || detailUrl,
            applicationEmail: email,
            ...contactInfo,
            referenceNumber,
            salaryRequestedInPosting,
          };

          // Filter out non-DACH jobs (LinkedIn often returns global results)
          if (!this.isDACHLocation(card.location)) {
            logger.debug(`LinkedIn: skipping non-DACH job "${card.title}" in "${card.location}"`);
            continue;
          }

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

  private isDACHLocation(location: string): boolean {
    if (!location) return false;
    const loc = location.toLowerCase();
    const dachPatterns = [
      // Countries
      'switzerland', 'schweiz', 'suisse', 'svizzera',
      'germany', 'deutschland', 'austria', 'österreich', 'oesterreich',
      // Swiss cities
      'zürich', 'zurich', 'zuerich', 'basel', 'bern', 'berne',
      'genf', 'geneva', 'genève', 'lausanne', 'luzern', 'lucerne',
      'lugano', 'winterthur', 'st. gallen', 'st gallen', 'aarau',
      'baden', 'olten', 'solothurn', 'thun', 'biel', 'schaffhausen',
      'frauenfeld', 'liestal', 'zug', 'schwyz', 'chur', 'sion',
      'fribourg', 'neuchâtel', 'neuchatel', 'pratteln', 'muttenz',
      'allschwil', 'reinach', 'binningen', 'munchenstein', 'riehen',
      // German cities
      'berlin', 'münchen', 'munich', 'hamburg', 'frankfurt', 'köln',
      'cologne', 'stuttgart', 'düsseldorf', 'dortmund', 'freiburg',
      'karlsruhe', 'mannheim', 'konstanz', 'lörrach',
      // Austrian cities
      'wien', 'vienna', 'graz', 'salzburg', 'innsbruck', 'linz',
    ];
    return dachPatterns.some(p => loc.includes(p));
  }

  private getSwissGeoId(location: string): string {
    const loc = location.toLowerCase();
    // LinkedIn geoIds for Swiss cities/regions
    if (loc.includes('zürich') || loc.includes('zuerich') || loc.includes('zurich')) return '106442186';
    if (loc.includes('basel')) return '105210301';
    if (loc.includes('bern')) return '106903546';
    if (loc.includes('genf') || loc.includes('geneva') || loc.includes('genève')) return '105605498';
    if (loc.includes('lausanne')) return '101048506';
    if (loc.includes('schweiz') || loc.includes('switzerland')) return '106693272';
    return '106693272'; // Default: Switzerland
  }
}
