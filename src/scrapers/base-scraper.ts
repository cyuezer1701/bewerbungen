import puppeteer, { type Browser, type Page } from 'puppeteer';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { extractEmails } from '../utils/sanitize.js';
import { getSetting } from '../db/settings.js';

function findPlaywrightChrome(): string | undefined {
  try {
    const base = join(homedir(), '.cache', 'ms-playwright');
    const dirs = readdirSync(base).filter(d => d.startsWith('chromium-')).sort();
    if (dirs.length > 0) {
      const chromePath = join(base, dirs[dirs.length - 1], 'chrome-linux', 'chrome');
      if (existsSync(chromePath)) return chromePath;
    }
  } catch {
    // Playwright not installed
  }
  return undefined;
}

export interface ScrapedJob {
  sourceId: string;
  source: 'linkedin' | 'indeed' | 'jobsch' | 'glassdoor' | 'google';
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
  contactPerson?: string;
  contactGender?: 'f' | 'm' | 'unknown';
  contactTitle?: string;
  contactDepartment?: string;
  referenceNumber?: string;
  salaryRequestedInPosting?: boolean;
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

  protected extractContactInfo(text: string): {
    contactPerson?: string;
    contactGender?: 'f' | 'm' | 'unknown';
    contactTitle?: string;
    contactDepartment?: string;
  } {
    const patterns = [
      /(?:Kontakt|Ansprechperson|Ihre Kontaktperson|Kontaktieren Sie|Your contact|Contact person)[:\s]+(?:(Dr\.|Prof\.)\s+)?([A-ZÄÖÜ][a-zäöüéèê]+\s+[A-ZÄÖÜ][a-zäöüéèê]+)/i,
      /(?:Fragen|questions)\??\s*(?:an|to|bei)?\s*(?:(Dr\.|Prof\.)\s+)?([A-ZÄÖÜ][a-zäöüéèê]+\s+[A-ZÄÖÜ][a-zäöüéèê]+)/i,
    ];

    let person: string | undefined;
    let title: string | undefined;

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        title = match[1] || undefined;
        person = match[2]?.trim();
        break;
      }
    }

    // Also try to detect from email pattern: vorname.nachname@
    if (!person) {
      const emailMatch = text.match(/([a-zäöü]+)\.([a-zäöü]+)@/i);
      if (emailMatch) {
        const first = emailMatch[1].charAt(0).toUpperCase() + emailMatch[1].slice(1).toLowerCase();
        const last = emailMatch[2].charAt(0).toUpperCase() + emailMatch[2].slice(1).toLowerCase();
        person = `${first} ${last}`;
      }
    }

    let gender: 'f' | 'm' | 'unknown' = 'unknown';
    if (person) {
      const firstName = person.split(/\s+/)[0].toLowerCase();
      gender = guessGender(firstName);
    }

    // Extract department
    let department: string | undefined;
    const deptMatch = text.match(/(?:Abteilung|Department|Bereich)[:\s]+([^\n,]+)/i);
    if (deptMatch) {
      department = deptMatch[1].trim();
    } else if (/human\s*resources|HR|personalabteilung|recruiting/i.test(text)) {
      department = 'Human Resources';
    }

    return { contactPerson: person, contactGender: gender, contactTitle: title, contactDepartment: department };
  }

  protected extractReferenceNumber(text: string): string | undefined {
    const patterns = [
      /(?:Ref\.?\s*(?:Nr\.?)?|Referenz(?:nummer)?|Stellen-?ID|Job-?ID|Kennziffer|Kennzahl)[:\s]+([A-Z0-9][\w-]{2,20})/i,
      /\b([A-Z]{2,4}-\d{4}-\d{3,6})\b/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return undefined;
  }

  protected detectSalaryRequested(text: string): boolean {
    const patterns = [
      /gehaltsvorstellung/i,
      /lohnvorstellung/i,
      /sal[aä]r(?:anspruch|vorstellung)/i,
      /finanziellen?\s+vorstellung/i,
      /gew[üu]nschtes?\s+(?:jahres)?gehalt/i,
      /salary\s+expectation/i,
    ];
    return patterns.some(p => p.test(text));
  }
}

const FEMALE_NAMES = new Set([
  'anna', 'maria', 'sarah', 'sandra', 'claudia', 'monika', 'petra', 'andrea', 'christine',
  'nicole', 'daniela', 'katharina', 'julia', 'stefanie', 'martina', 'sabine', 'barbara',
  'susanne', 'simone', 'karin', 'cornelia', 'silvia', 'eva', 'ruth', 'elisabeth', 'ursula',
  'verena', 'brigitte', 'franziska', 'corinne', 'nadine', 'melanie', 'manuela', 'jasmin',
  'laura', 'lisa', 'nina', 'sophie', 'lena', 'emma', 'mia', 'lea', 'nathalie', 'céline',
]);
const MALE_NAMES = new Set([
  'peter', 'hans', 'thomas', 'daniel', 'martin', 'michael', 'markus', 'stefan', 'christian',
  'andreas', 'marco', 'patrick', 'reto', 'david', 'simon', 'pascal', 'felix', 'beat',
  'bruno', 'walter', 'werner', 'kurt', 'paul', 'jan', 'marc', 'lukas', 'tim', 'tobias',
  'philipp', 'oliver', 'sandro', 'roger', 'marcel', 'adrian', 'florian', 'nico', 'jonas',
  'alex', 'matthias', 'dominik', 'samuel', 'benjamin', 'raphael', 'fabian', 'yannick',
]);

function guessGender(firstName: string): 'f' | 'm' | 'unknown' {
  const lower = firstName.toLowerCase();
  if (FEMALE_NAMES.has(lower)) return 'f';
  if (MALE_NAMES.has(lower)) return 'm';
  return 'unknown';
}

// User agents for rotation (updated to current browser versions)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Randomized viewport dimensions for anti-fingerprinting
export function getRandomViewport(): { width: number; height: number } {
  const width = 1366 + Math.floor(Math.random() * (1920 - 1366));
  const height = 768 + Math.floor(Math.random() * (1080 - 768));
  return { width, height };
}

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

function getBrowserOptions() {
  const vp = getRandomViewport();
  const args = [...BROWSER_ARGS, `--window-size=${vp.width},${vp.height}`];

  // Add proxy if configured
  const proxy = getSetting('scraper_proxy');
  if (proxy) {
    args.push(`--proxy-server=${proxy}`);
    logger.info(`Browser using proxy: ${proxy}`);
  }

  const opts: Record<string, unknown> = {
    headless: true,
    args,
  };
  // Use PUPPETEER_EXECUTABLE_PATH if set, otherwise try to find a working Chrome
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    // On ARM64, Puppeteer's bundled Chrome is x86-only. Use Playwright's Chrome if available.
    const chromePath = findPlaywrightChrome();
    if (chromePath) {
      opts.executablePath = chromePath;
      logger.info(`Using Playwright Chrome: ${chromePath}`);
    }
  }
  return opts;
}

export async function launchStealthBrowser(): Promise<Browser> {
  // Try to use puppeteer-extra with stealth, fall back to plain puppeteer
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const puppeteerExtra = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteerExtra.use(StealthPlugin());

    const browser = await puppeteerExtra.launch(getBrowserOptions());
    logger.info('Stealth browser launched');
    return browser as unknown as Browser;
  } catch (err) {
    logger.warn('puppeteer-extra stealth not available, using plain puppeteer', {
      error: err instanceof Error ? err.message : err,
    });

    const browser = await puppeteer.launch(getBrowserOptions());
    logger.info('Plain browser launched');
    return browser;
  }
}
