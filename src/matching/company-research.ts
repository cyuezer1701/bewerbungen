import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getDb } from '../db/index.js';
import { withRetry } from '../utils/retry.js';

export interface CompanyResearch {
  company_full_name: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  department: string;
  industry: string;
  employee_count: string;
  culture_values: string;
  recent_news: string;
  relevant_projects: string;
  website: string;
  careers_page: string;
}

const EMPTY_RESEARCH: CompanyResearch = {
  company_full_name: '',
  street: '',
  zip: '',
  city: '',
  country: 'Schweiz',
  department: '',
  industry: '',
  employee_count: '',
  culture_values: '',
  recent_news: '',
  relevant_projects: '',
  website: '',
  careers_page: '',
};

export function getCachedResearch(companyName: string): CompanyResearch | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM company_research
    WHERE company_name = ?
    AND researched_at > datetime('now', '-30 days')
  `).get(companyName) as Record<string, string> | undefined;
  if (!row) return null;
  return {
    company_full_name: row.full_name || '',
    street: row.street || '',
    zip: row.zip || '',
    city: row.city || '',
    country: row.country || 'Schweiz',
    department: row.department || '',
    industry: row.industry || '',
    employee_count: row.employee_count || '',
    culture_values: row.culture_values || '',
    recent_news: row.recent_news || '',
    relevant_projects: row.relevant_projects || '',
    website: row.website || '',
    careers_page: row.careers_page || '',
  };
}

export function saveResearch(companyName: string, research: CompanyResearch): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO company_research
    (company_name, full_name, street, zip, city, country, department, industry,
     employee_count, culture_values, recent_news, relevant_projects, website, careers_page, researched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    companyName,
    research.company_full_name,
    research.street,
    research.zip,
    research.city,
    research.country,
    research.department,
    research.industry,
    research.employee_count,
    research.culture_values,
    research.recent_news,
    research.relevant_projects,
    research.website,
    research.careers_page
  );
}

export function updateResearchAddress(
  companyName: string,
  street: string,
  zip: string,
  city: string
): void {
  const db = getDb();
  const existing = db.prepare('SELECT company_name FROM company_research WHERE company_name = ?').get(companyName);
  if (existing) {
    db.prepare(`
      UPDATE company_research SET street = ?, zip = ?, city = ?, researched_at = datetime('now')
      WHERE company_name = ?
    `).run(street, zip, city, companyName);
  } else {
    db.prepare(`
      INSERT INTO company_research (company_name, full_name, street, zip, city, country, researched_at)
      VALUES (?, ?, ?, ?, ?, 'Schweiz', datetime('now'))
    `).run(companyName, companyName, street, zip, city);
  }
}

export async function researchCompany(company: string, location: string): Promise<CompanyResearch> {
  // Check cache first
  const cached = getCachedResearch(company);
  if (cached) {
    logger.info(`Company research cache hit: ${company}`);
    return cached;
  }

  logger.info(`Researching company: ${company} (${location})`);

  const prompt = `Recherchiere die Firma "${company}" mit Sitz in "${location}" für eine Bewerbung.
Suche nach:

Vollständige Firmenadresse (Strasse, PLZ, Ort) — suche auf der Firmenwebsite unter Kontakt/Impressum
Aktuelle News oder Projekte der Firma (letzte 6 Monate)
Unternehmenskultur und Werte (von Karriereseite oder About-Seite)
Branche und Firmengrösse (Anzahl Mitarbeiter)
Rechtsform (AG, GmbH, SA, etc.) für den vollständigen Firmennamen

Antwort NUR als JSON, kein Markdown, keine Backticks:
{
  "company_full_name": "Firmenname inkl. Rechtsform",
  "street": "Strasse und Hausnummer",
  "zip": "PLZ",
  "city": "Ort",
  "country": "Schweiz",
  "department": "Human Resources",
  "industry": "Branche",
  "employee_count": "ca. Anzahl",
  "culture_values": "Werte und Kultur",
  "recent_news": "Aktuelle Nachrichten",
  "relevant_projects": "Relevante Projekte",
  "website": "https://www.firma.com",
  "careers_page": "https://www.firma.com/careers"
}`;

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  try {
    const response = await withRetry(async () => {
      return client.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: 4096,
        tools: [{ type: 'web_search_20250305' as never, name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      });
    });

    // Extract text from response (may contain multiple content blocks from web search)
    const textBlock = response.content.find(b => b.type === 'text');
    const text = textBlock && 'text' in textBlock ? textBlock.text : '';

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn(`No JSON in company research response for ${company}`);
      throw new Error('No JSON in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const research: CompanyResearch = {
      company_full_name: parsed.company_full_name || company,
      street: parsed.street || '',
      zip: parsed.zip || '',
      city: parsed.city || location || '',
      country: parsed.country || 'Schweiz',
      department: parsed.department || '',
      industry: parsed.industry || '',
      employee_count: parsed.employee_count || '',
      culture_values: parsed.culture_values || '',
      recent_news: parsed.recent_news || '',
      relevant_projects: parsed.relevant_projects || '',
      website: parsed.website || '',
      careers_page: parsed.careers_page || '',
    };

    saveResearch(company, research);
    logger.info(`Company research complete: ${company} -> ${research.company_full_name} (${research.zip} ${research.city})`);
    return research;
  } catch (err) {
    logger.warn(`Company research failed for ${company}`, { error: err instanceof Error ? err.message : err });
    // Return fallback with what we know
    const fallback: CompanyResearch = {
      ...EMPTY_RESEARCH,
      company_full_name: company,
      city: location || '',
    };
    return fallback;
  }
}
