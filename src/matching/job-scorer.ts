import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { Semaphore } from '../utils/semaphore.js';
import type { JobRow } from '../db/queries.js';
import type { StructuredCV } from './cv-parser.js';

export interface SalaryEstimate {
  min: number;
  max: number;
  realistic: number;
  currency: string;
  reasoning: string;
}

export interface JobMatchResult {
  match_score: number;
  reasoning: string;
  matching_skills: string[];
  missing_skills: string[];
  salary_estimate: SalaryEstimate;
  recommendation: 'apply' | 'maybe' | 'skip';
  cover_letter_focus: string;
}

export const scoringSemaphore = new Semaphore(10);

// --- Scoring ---

const SCORING_PROMPT = `Du bist ein Karriereberater und Gehaltsexperte fuer den DACH-Markt (Schweiz, Deutschland, Oesterreich).
Bewerte wie gut dieser Job zum Kandidaten passt und schaetze das realistische Gehalt.

KANDIDAT:
{cv}

JOB:
Titel: {title}
Firma: {company}
Ort: {location}
Beschreibung: {description}
Gehalt laut Inserat: {salaryRange}
Bewerbungsweg: {applicationMethod}

GEHALTSSCHAETZUNG REGELN:
- Beruecksichtige den Standort (Schweiz zahlt deutlich mehr als DE/AT)
- Beruecksichtige Firmengroesse und Branche
- Beruecksichtige die Erfahrung und Skills des Kandidaten
- "realistic" = was der Kandidat realistisch verhandeln kann basierend auf seinem Profil
- Falls das Inserat ein Gehalt nennt, nutze das als Ankerpunkt
- Waehrung: CHF fuer Schweiz, EUR fuer DE/AT
- Immer Brutto Jahresgehalt

Antwort NUR als JSON, kein Markdown, keine Backticks:
{
    "match_score": 0-100,
    "reasoning": "2-3 Saetze warum dieser Score",
    "matching_skills": ["Skills die passen"],
    "missing_skills": ["Skills die fehlen"],
    "salary_estimate": {
        "min": 95000,
        "max": 130000,
        "realistic": 115000,
        "currency": "CHF",
        "reasoning": "Begruendung: Marktlage, Region, Firmengroesse, Kandidat-Profil"
    },
    "recommendation": "apply | maybe | skip",
    "cover_letter_focus": "Worauf das Anschreiben fokussieren sollte"
}`;

function buildScoringPrompt(job: JobRow, cv: StructuredCV): string {
  return SCORING_PROMPT
    .replace('{cv}', JSON.stringify(cv, null, 2))
    .replace('{title}', job.title)
    .replace('{company}', job.company)
    .replace('{location}', job.location || 'nicht angegeben')
    .replace('{description}', job.description || 'keine Beschreibung')
    .replace('{salaryRange}', job.salary_range || 'nicht angegeben')
    .replace('{applicationMethod}', job.application_method || 'nicht angegeben');
}

function parseJsonResponse(text: string): unknown {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

export async function scoreJob(
  job: JobRow,
  cv: StructuredCV
): Promise<JobMatchResult> {
  await scoringSemaphore.acquire();

  try {
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    const prompt = buildScoringPrompt(job, cv);

    const result = await withRetry(async () => {
      const response = await client.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude API');
      }

      return parseJsonResponse(textBlock.text) as JobMatchResult;
    });

    // Normalize recommendation value
    if (typeof result.recommendation === 'string') {
      result.recommendation = result.recommendation.trim().split(/\s/)[0] as JobMatchResult['recommendation'];
    }

    logger.info(
      `Scored "${job.title}" at ${job.company}: ${result.match_score}/100 (${result.recommendation}) ~${result.salary_estimate.currency} ${result.salary_estimate.realistic}`
    );

    return result;
  } finally {
    scoringSemaphore.release();
  }
}
