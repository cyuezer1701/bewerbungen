import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { JobRow } from '../db/queries.js';
import type { StructuredCV } from '../matching/cv-parser.js';

const COVER_LETTER_PROMPT = `Du bist ein erfahrener Bewerbungscoach fuer den DACH-Markt (Schweiz/Deutschland/Oesterreich).
Schreibe ein professionelles, individuelles Bewerbungsschreiben.

REGELN:
- Sprache: Deutsch (Schweizer Stil, kein ß, kein Genitiv-s wo unueblich)
- Kein generischer Floskeln ("mit grossem Interesse habe ich...")
- Direkt, selbstbewusst, konkret
- Bezug auf spezifische Anforderungen aus der Stellenbeschreibung
- Erwaehne 2-3 konkrete Erfolge/Projekte aus dem CV die relevant sind
- Laenge: ca. 250-350 Woerter
- Keine Emojis, keine Aufzaehlungszeichen im Fliesstext
- KEINE Bindestriche verwenden, sie wirken maschinell
- Format: Absender, Datum, Empfaenger, Betreff, Anrede, 3-4 Absaetze, Gruss

KANDIDAT:
{cv}

JOB:
Titel: {title}
Firma: {company}
Ort: {location}
Beschreibung: {description}

FOKUS-EMPFEHLUNG VOM MATCHING:
{focus}

Antwort als reiner Text (kein Markdown), bereit fuer PDF-Generierung.`;

export async function generateCoverLetter(
  job: JobRow,
  cv: StructuredCV,
  focus: string,
  feedback?: string
): Promise<string> {
  let prompt = COVER_LETTER_PROMPT
    .replace('{cv}', JSON.stringify(cv, null, 2))
    .replace('{title}', job.title)
    .replace('{company}', job.company)
    .replace('{location}', job.location || 'nicht angegeben')
    .replace('{description}', job.description || 'keine Beschreibung')
    .replace('{focus}', focus);

  if (feedback) {
    prompt += `\n\nZUSAETZLICHES FEEDBACK VOM BEWERBER:\n${feedback}\n\nBitte beruecksichtige dieses Feedback bei der Ueberarbeitung.`;
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const text = await withRetry(async () => {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude API');
    }

    return textBlock.text;
  });

  logger.info(`Cover letter generated for "${job.title}" at ${job.company} (${text.split(/\s+/).length} words)`);
  return text;
}
