import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { CoverLetterContent } from './cover-letter.js';
import type { StructuredCV } from '../matching/cv-parser.js';

export interface FactCheckResult {
  verified: boolean;
  violations: string[];
}

export async function verifyFacts(
  content: CoverLetterContent,
  cv: StructuredCV
): Promise<FactCheckResult> {
  const coverLetterText = [
    content.absatz_1,
    content.absatz_2,
    content.absatz_3,
    content.absatz_4,
  ].join('\n\n');

  const prompt = `Du bist ein Faktenpruefer. Vergleiche JEDE faktische Behauptung im Anschreiben mit dem Lebenslauf.

LEBENSLAUF:
${JSON.stringify(cv, null, 2)}

ANSCHREIBEN:
${coverLetterText}

Pruefe:
1. Werden Projekte, Firmen, Rollen oder Technologien erwaehnt die NICHT im CV stehen?
2. Werden Zahlen, Metriken oder Zeitraeume genannt die NICHT im CV verifizierbar sind?
3. Werden Erfolge oder Erfahrungen behauptet die nirgends im CV erwaehnt werden?
4. FIRMENNAMEN: Pruefe ob alle erwaehnte Firmennamen EXAKT so im CV geschrieben sind. Gaengige Varianten sind erlaubt (z.B. "Roche" = "F. Hoffmann-La Roche"), aber FALSCHE Kombinationen zweier verschiedener Firmen (z.B. "Helvetia Baloise" wenn es zwei separate Firmen "Helvetia" und "Baloise" sind) sind ein schwerwiegender Verstoss.

WICHTIG: Allgemeine Formulierungen wie "Erfahrung in X" sind OK wenn der CV X in irgendeiner Form bestaetigt.
Nur KONKRETE falsche Behauptungen sind Verstoesse.

Antworte NUR mit JSON (kein Markdown, keine Backticks):
{
  "verified": true/false,
  "violations": ["Liste der konkreten Verstoesse, leer wenn verified=true"]
}`;

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const result = await withRetry(async () => {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude API');
    }

    let cleaned = textBlock.text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    return JSON.parse(cleaned) as FactCheckResult;
  });

  // Normalize
  if (!Array.isArray(result.violations)) {
    result.violations = [];
  }
  result.verified = result.violations.length === 0;

  logger.info(`Fact check: ${result.verified ? 'PASSED' : `FAILED (${result.violations.length} violations)`}`);

  return result;
}
