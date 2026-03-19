import type { Browser } from 'puppeteer';
import { BaseScraper, type ScrapedJob, getRandomUserAgent } from './base-scraper.js';
import { logger } from '../utils/logger.js';
import { getJobBySourceId } from '../db/queries.js';

/**
 * Indeed scraper using RSS feeds + detail page scraping.
 * RSS feeds never trigger CAPTCHA since they're a public data format.
 * Only detail pages use the browser, and with proper delays they work fine.
 */
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

      for (const keyword of keywords) {
        if (jobs.length >= maxJobs) break;

        logger.info(`Indeed: searching "${keyword}" in ${location}`);

        // Use RSS feed — no CAPTCHA, no blocks
        const rssUrl = `https://ch.indeed.com/rss?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}&fromage=3&sort=date`;

        try {
          const response = await fetch(rssUrl, {
            headers: {
              'User-Agent': getRandomUserAgent(),
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            },
          });

          if (!response.ok) {
            logger.warn(`Indeed RSS: HTTP ${response.status} for "${keyword}"`);
            continue;
          }

          const xml = await response.text();
          const items = this.parseRssItems(xml);

          logger.info(`Indeed: found ${items.length} jobs via RSS for "${keyword}"`);

          for (const item of items) {
            if (jobs.length >= maxJobs) break;
            if (!item.title || !item.sourceId) continue;

            // Check for existing job in DB
            const existing = getJobBySourceId('indeed', item.sourceId);
            if (existing) {
              logger.debug(`Indeed: skipping existing job ${item.sourceId}`);
              continue;
            }

            // Try to get full description from detail page
            let description = item.description;
            await this.delay(3000, 6000);

            const detailNavigated = await this.safeGoto(page, item.sourceUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 30000,
            });

            if (detailNavigated) {
              await this.delay(2000, 4000);

              const pageContent = await page.content();
              if (!pageContent.includes('captcha') && !pageContent.includes('blocked')) {
                const fullDescription = await this.getTextContent(
                  page,
                  '#jobDescriptionText, .jobsearch-jobDescriptionText, [id="jobDescriptionText"]'
                );
                if (fullDescription) {
                  description = fullDescription;
                }
              }
            }

            const { method, url, email } = this.detectApplicationMethod(
              description,
              true,
              item.sourceUrl
            );

            const contactInfo = this.extractContactInfo(description);
            const referenceNumber = this.extractReferenceNumber(description);
            const salaryRequestedInPosting = this.detectSalaryRequested(description);

            const job: ScrapedJob = {
              sourceId: item.sourceId,
              source: 'indeed',
              title: item.title,
              company: item.company,
              location: item.location,
              description,
              sourceUrl: item.sourceUrl,
              postedAt: item.postedAt,
              applicationMethod: method,
              applicationUrl: url || item.sourceUrl,
              applicationEmail: email,
              ...contactInfo,
              referenceNumber,
              salaryRequestedInPosting,
            };

            jobs.push(job);
            logger.info(`Indeed: scraped "${job.title}" at ${job.company}`);
          }
        } catch (err) {
          logger.warn(`Indeed RSS fetch failed for "${keyword}": ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      logger.error('Indeed scraper error', { error: err });
    } finally {
      await page.close();
    }

    return jobs;
  }

  private parseRssItems(xml: string): Array<{
    title: string;
    company: string;
    location: string;
    description: string;
    sourceUrl: string;
    sourceId: string;
    postedAt?: string;
  }> {
    const items: Array<{
      title: string;
      company: string;
      location: string;
      description: string;
      sourceUrl: string;
      sourceId: string;
      postedAt?: string;
    }> = [];

    // Simple XML parsing — Indeed RSS is well-structured
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];

      const title = this.extractTag(itemXml, 'title');
      const link = this.extractTag(itemXml, 'link');
      const description = this.stripHtml(this.extractTag(itemXml, 'description'));
      const pubDate = this.extractTag(itemXml, 'pubDate');
      const source = this.extractTag(itemXml, 'source');

      // Extract location from geo tags or title
      const geoLat = this.extractTag(itemXml, 'georss:point');
      const formattedLocation = this.extractTag(itemXml, 'formattedLocation') ||
        this.extractTag(itemXml, 'indeed:formattedLocation') || '';

      // Extract job key from URL
      const jkMatch = link.match(/jk=([a-f0-9]+)/i) || link.match(/\/([a-f0-9]{16})/);
      const sourceId = jkMatch?.[1] || link.replace(/[^a-z0-9]/gi, '').slice(-16);

      if (title && link) {
        items.push({
          title,
          company: source || '',
          location: formattedLocation,
          description,
          sourceUrl: link,
          sourceId,
          postedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
        });
      }
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string {
    // Handle CDATA sections
    const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
    const cdataMatch = xml.match(cdataRegex);
    if (cdataMatch) return cdataMatch[1].trim();

    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const m = xml.match(regex);
    return m ? m[1].trim() : '';
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
