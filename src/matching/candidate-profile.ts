import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { getSetting } from '../db/settings.js';
import { upsertCandidateProfile, getActiveWishes, getCandidateProfile } from '../db/queries.js';
import type { StructuredCV } from './cv-parser.js';
import type { CandidateWishRow } from '../db/queries.js';

export interface SearchStrategy {
  primary: string[];
  secondary: string[];
  opportunistic: string[];
  exclude: string[];
}

export interface CandidateProfile {
  career_trajectory: string;
  avoid_roles: string[];
  strengths: string[];
  usps: string[];
  ideal_companies: string;
  search_strategy: SearchStrategy;
  salary_insight: string;
  wishes_summary: string;
}

function formatWishesForPrompt(wishes: CandidateWishRow[]): string {
  if (wishes.length === 0) return 'Keine spezifischen Wuensche angegeben.';
  return wishes.map((w) => `- [${w.category}/${w.priority}] ${w.wish}`).join('\n');
}

export async function generateCandidateProfile(
  cv: StructuredCV,
  wishes?: CandidateWishRow[]
): Promise<CandidateProfile> {
  const activeWishes = wishes ?? getActiveWishes();
  const salaryMin = getSetting('salary_expectation_min') || '0';
  const salaryMax = getSetting('salary_expectation_max') || '0';
  const salaryIdeal = getSetting('salary_expectation_ideal') || '0';
  const salaryCurrency = getSetting('salary_currency_default') || 'CHF';

  const salaryExpectation = salaryIdeal !== '0'
    ? `${salaryCurrency} ${salaryMin} – ${salaryMax} (ideal: ${salaryIdeal})`
    : 'Nicht angegeben';

  const prompt = `Du bist ein erfahrener Headhunter fuer den DACH-Markt mit 20 Jahren Erfahrung.

LEBENSLAUF:
${JSON.stringify(cv, null, 2)}

WUENSCHE DES KANDIDATEN:
${formatWishesForPrompt(activeWishes)}

GEHALTSVORSTELLUNG: ${salaryExpectation}

Erstelle ein tiefes Kandidaten-Profil. Denke wie ein Headhunter:
- Wo kommt der Kandidat her? Wo geht die Karriere hin?
- Was sind die echten Staerken (mit Beweis aus dem CV)?
- Was macht ihn einzigartig gegenueber anderen Bewerbern?
- Welche Firmen passen WIRKLICH zu ihm?
- Welche Suchbegriffe wuerdest du als Headhunter nutzen?
- Welche Positionen soll er VERMEIDEN (Rueckschritt, falsche Richtung)?

Antworte NUR mit JSON (kein Markdown, keine Erklaerungen):
{
  "career_trajectory": "Wo kommt er her, wo geht es hin? 3-4 Saetze",
  "avoid_roles": ["Positionen die ein Rueckschritt waeren oder nicht passen"],
  "strengths": ["Top 5-7 Staerken mit Beweis aus dem CV"],
  "usps": ["3-4 Alleinstellungsmerkmale gegenueber anderen Kandidaten"],
  "ideal_companies": "Welcher Firmentyp passt? Groesse, Branche, Kultur. 2-3 Saetze",
  "search_strategy": {
    "primary": ["3-5 Haupt-Jobtitel/Keywords fuer die Suche"],
    "secondary": ["3-5 Ergaenzungs-Keywords"],
    "opportunistic": ["2-3 Langschuss-Keywords fuer Ueberraschungstreffer"],
    "exclude": ["Anti-Keywords die irrelevante Jobs bringen"]
  },
  "salary_insight": "Gehaltseinschaetzung basierend auf Profil und Markt. 2 Saetze",
  "wishes_summary": "Zusammenfassung der Kandidaten-Wuensche und wie sie die Suche beeinflussen"
}`;

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const responseText = await withRetry(async () => {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude API');
    return textBlock.text;
  });

  const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as CandidateProfile;

  // Save to DB
  upsertCandidateProfile({
    career_trajectory: parsed.career_trajectory,
    avoid_roles: JSON.stringify(parsed.avoid_roles),
    strengths: JSON.stringify(parsed.strengths),
    usps: JSON.stringify(parsed.usps),
    ideal_companies: parsed.ideal_companies,
    search_strategy_keywords: JSON.stringify(parsed.search_strategy),
    salary_insight: parsed.salary_insight,
    wishes: parsed.wishes_summary,
    raw_assessment: cleaned,
  });

  logger.info('Candidate profile generated and saved');
  return parsed;
}

export function loadCandidateProfile(): CandidateProfile | null {
  const row = getCandidateProfile();
  if (!row || !row.raw_assessment) return null;

  try {
    return JSON.parse(row.raw_assessment) as CandidateProfile;
  } catch {
    logger.warn('Failed to parse stored candidate profile');
    return null;
  }
}
