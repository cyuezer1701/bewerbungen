import puppeteer, { type Browser, type Page } from 'puppeteer';
import { logger } from '../utils/logger.js';
import { extractEmails } from '../utils/sanitize.js';

export interface ScrapedJob {
  sourceId: string;
  source: 'linkedin' | 'indeed' | 'jobsch';
  title: string;
  company: string;
  location: string;
  description: string;
  salaryRange?: string;
  sourceUrl: string;
  postedAt?: string;
  applicationMethod: 'email' | 'portal' | 'both';
  applicationUrl?: string;
  applicationEmail?: string;
}

export abstract class BaseScraper {
  abstract readonly name: string;
  abstract readonly source: ScrapedJob['source'];

  abstract scrape(
    keywords: string[],
    location: string,
    browser: Browser,
    maxJobs: number
  ): Promise<ScrapedJob[]>;

  protected async delay(minMs: number, maxMs: number): Promise<void> {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected extractEmails(text: string): string[] {
    return extractEmails(text);
  }

  protected detectApplicationMethod(
    description: string,
    hasPortalLink: boolean,
    portalUrl?: string
  ): {
    method: ScrapedJob['applicationMethod'];
    url?: string;
    email?: string;
  } {
    const emails = this.extractEmails(description);
    const hasEmail = emails.length > 0;

    if (hasEmail && hasPortalLink) {
      return { method: 'both', url: portalUrl, email: emails[0] };
    }
    if (hasEmail) {
      return { method: 'email', email: emails[0] };
    }
    return { method: 'portal', url: portalUrl };
  }

  protected async safeGoto(
    page: Page,
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'; timeout?: number }
  ): Promise<boolean> {
    try {
      await page.goto(url, {
        waitUntil: options?.waitUntil ?? 'domcontentloaded',
        timeout: options?.timeout ?? 30000,
      });
      return true;
    } catch (err) {
      logger.warn(`Failed to navigate to ${url}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  protected async safeWaitForSelector(
    page: Page,
    selector: string,
    timeout = 10000
  ): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  protected async getTextContent(page: Page, selector: string): Promise<string> {
    try {
      return await page.$eval(selector, (el) => el.textContent?.trim() || '');
    } catch {
      return '';
    }
  }
}

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function launchStealthBrowser(): Promise<Browser> {
  // Try to use puppeteer-extra with stealth, fall back to plain puppeteer
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const puppeteerExtra = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteerExtra.use(StealthPlugin());

    const browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });
    logger.info('Stealth browser launched');
    return browser as unknown as Browser;
  } catch (err) {
    logger.warn('puppeteer-extra stealth not available, using plain puppeteer', {
      error: err instanceof Error ? err.message : err,
    });

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });
    logger.info('Plain browser launched');
    return browser;
  }
}
