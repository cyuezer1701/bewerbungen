import { logger } from './logger.js';

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
      },
    });
    if (!response.ok) return '';
    const html = await response.text();
    return stripHtml(html);
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCompanyInfo(url?: string): Promise<string> {
  if (!url) return '';

  try {
    const parsedUrl = new URL(url);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

    // Fetch homepage and about page in parallel
    const aboutPaths = ['/about', '/ueber-uns', '/about-us'];
    const [homepage, ...aboutPages] = await Promise.all([
      fetchPage(baseUrl),
      ...aboutPaths.map((p) => fetchPage(`${baseUrl}${p}`)),
    ]);

    // Combine results, prioritize about page content
    const aboutContent = aboutPages.filter(Boolean).join(' ');
    const combined = aboutContent
      ? `${aboutContent} ${homepage}`.trim()
      : homepage;

    if (!combined) return '';

    // Truncate to 2000 chars
    return combined.length > 2000 ? combined.slice(0, 2000) : combined;
  } catch (err) {
    logger.debug('Company research failed', { url, error: err instanceof Error ? err.message : err });
    return '';
  }
}
