import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { checkBlacklist, checkAiTransitions, checkHyphens } from './blacklist.js';
import type { CoverLetterContent } from './cover-letter.js';

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

export interface HumanizeReport {
  original: string;
  humanized: string;
  changes: string[];
  score: number;
  flaggedPatterns: string[];
}

const STOP_WORDS = new Set([
  'der', 'die', 'das', 'und', 'in', 'von', 'mit', 'ist', 'ein', 'zu',
  'für', 'fuer', 'auf', 'als', 'ich', 'mich', 'mir', 'sich', 'den', 'dem',
  'des', 'eine', 'einer', 'auch', 'nicht', 'an', 'bei', 'nach', 'aus',
  'wie', 'oder', 'aber', 'hat', 'wird', 'sind', 'war', 'dass', 'so',
  'im', 'am', 'es', 'er', 'sie', 'wir', 'uns', 'vom', 'zum', 'zur',
  'eines', 'einem', 'einen', 'diese', 'dieser', 'diesem', 'dieses',
  'meine', 'meiner', 'meinem', 'meinen', 'mein', 'haben', 'habe',
  'kann', 'konnte', 'bin', 'vor', 'ueber', 'über', 'noch', 'schon',
  'nur', 'sehr', 'mehr', 'bereits', 'seit', 'durch',
]);

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function checkSentenceStartVariety(text: string): string[] {
  const violations: string[] = [];
  const sentences = splitSentences(text);
  const firstWords = sentences.map((s) => s.split(/\s+/)[0]?.toLowerCase() || '');

  for (let i = 0; i <= firstWords.length - 3; i++) {
    if (firstWords[i] && firstWords[i] === firstWords[i + 1] && firstWords[i] === firstWords[i + 2]) {
      violations.push(`3+ aufeinanderfolgende Saetze beginnen mit "${firstWords[i]}"`);
      break;
    }
  }

  return violations;
}

function checkSentenceLengthVariance(text: string): { stddev: number; violations: string[] } {
  const violations: string[] = [];
  const sentences = splitSentences(text);
  if (sentences.length < 3) return { stddev: 10, violations };

  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
  const stddev = Math.sqrt(variance);

  if (stddev < 3) {
    violations.push(`Satzlaengen zu einheitlich (Standardabweichung: ${stddev.toFixed(1)}, erwartet >= 3)`);
  }

  return { stddev, violations };
}

function checkWordRepetitions(text: string): string[] {
  const violations: string[] = [];
  const words = text.toLowerCase().replace(/[.,!?;:()"\-]/g, ' ').split(/\s+/).filter(Boolean);
  const counts = new Map<string, number>();

  for (const word of words) {
    if (STOP_WORDS.has(word) || word.length < 3) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  for (const [word, count] of counts) {
    if (count > 3) {
      violations.push(`Wort "${word}" kommt ${count}x vor (max 3)`);
    }
  }

  return violations;
}

function checkParagraphLength(content: CoverLetterContent): string[] {
  const violations: string[] = [];
  const paragraphs = [
    { name: 'absatz_1', text: content.absatz_1 },
    { name: 'absatz_2', text: content.absatz_2 },
    { name: 'absatz_3', text: content.absatz_3 },
    { name: 'absatz_4', text: content.absatz_4 },
  ];

  for (const { name, text } of paragraphs) {
    const sentenceCount = splitSentences(text).length;
    if (sentenceCount < 2) {
      violations.push(`${name}: nur ${sentenceCount} Satz (min 2)`);
    }
    if (sentenceCount > 6) {
      violations.push(`${name}: ${sentenceCount} Saetze (max 6)`);
    }
  }

  return violations;
}

function checkTotalWordCount(content: CoverLetterContent): string[] {
  const violations: string[] = [];
  const allText = [content.absatz_1, content.absatz_2, content.absatz_3, content.absatz_4].join(' ');
  const wordCount = allText.split(/\s+/).filter(Boolean).length;

  if (wordCount < 180) {
    violations.push(`Gesamttext zu kurz: ${wordCount} Woerter (min 180)`);
  }
  if (wordCount > 300) {
    violations.push(`Gesamttext zu lang: ${wordCount} Woerter (max 300)`);
  }

  return violations;
}

// --- Phase 14: Enhanced Human Score Checks ---

export function checkIchPercentage(text: string): { percentage: number; flagged: boolean } {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return { percentage: 0, flagged: false };
  const ichStarts = sentences.filter((s) => s.trim().toLowerCase().startsWith('ich ')).length;
  const percentage = (ichStarts / sentences.length) * 100;
  return { percentage, flagged: percentage > 30 };
}

export function checkConsecutiveSameStart(text: string): { found: boolean; word?: string } {
  const sentences = splitSentences(text);
  const firstWords = sentences.map((s) => s.split(/\s+/)[0]?.toLowerCase() || '');
  for (let i = 0; i < firstWords.length - 1; i++) {
    if (firstWords[i] && firstWords[i] === firstWords[i + 1]) {
      return { found: true, word: firstWords[i] };
    }
  }
  return { found: false };
}

export function checkParallelism(text: string): { found: boolean; pattern?: string } {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  for (const para of paragraphs) {
    const sentences = splitSentences(para);
    if (sentences.length < 3) continue;
    const prefixes = sentences.map((s) => s.split(/\s+/).slice(0, 3).join(' ').toLowerCase());
    for (let i = 0; i <= prefixes.length - 3; i++) {
      if (prefixes[i] === prefixes[i + 1] && prefixes[i] === prefixes[i + 2]) {
        return { found: true, pattern: prefixes[i] };
      }
    }
  }
  return { found: false };
}

export function checkNaturalElements(text: string): { hasNatural: boolean; missing: string[] } {
  const missing: string[] = [];
  const sentences = splitSentences(text);
  const naturalStarters = ['und', 'denn', 'doch', 'aber', 'oder'];
  const hasNaturalStarter = sentences.some((s) => {
    const first = s.split(/\s+/)[0]?.toLowerCase() || '';
    return naturalStarters.includes(first);
  });
  if (!hasNaturalStarter) missing.push('Kein Satzanfang mit Und/Denn/Doch/Aber');
  const hasParentheses = text.includes('(') && text.includes(')');
  const hasDash = text.includes(' – ') || text.includes(' — ');
  if (!hasParentheses && !hasDash) missing.push('Keine Klammern oder Gedankenstriche');
  return { hasNatural: missing.length === 0, missing };
}

// --- calculateHumanScore ---

export function calculateHumanScore(text: string): { score: number; details: Record<string, number>; flaggedPatterns: string[] } {
  const flaggedPatterns: string[] = [];
  const details: Record<string, number> = {};

  // 1. Satzlaengen-Varianz (25 Punkte)
  const { stddev } = checkSentenceLengthVariance(text);
  if (stddev >= 25) {
    details.sentence_variance = 25;
  } else if (stddev >= 15) {
    details.sentence_variance = Math.round(25 * ((stddev - 15) / 10));
  } else {
    details.sentence_variance = 0;
    flaggedPatterns.push(`Satzlaengen zu gleichmaessig (stddev: ${stddev.toFixed(1)})`);
  }

  // 2. Ich-Anteil (20 Punkte)
  const { percentage: ichPct } = checkIchPercentage(text);
  if (ichPct <= 20) {
    details.ich_percentage = 20;
  } else if (ichPct <= 40) {
    details.ich_percentage = Math.round(20 * ((40 - ichPct) / 20));
  } else {
    details.ich_percentage = 0;
    flaggedPatterns.push(`${Math.round(ichPct)}% der Saetze starten mit "Ich"`);
  }

  // 3. AI-Transitions (20 Punkte)
  const aiTransitions = checkAiTransitions(text);
  if (aiTransitions.length === 0) {
    details.ai_transitions = 20;
  } else if (aiTransitions.length <= 2) {
    details.ai_transitions = Math.round(20 * ((3 - aiTransitions.length) / 3));
    flaggedPatterns.push(`AI-Uebergaenge gefunden: ${aiTransitions.join(', ')}`);
  } else {
    details.ai_transitions = 0;
    flaggedPatterns.push(`${aiTransitions.length} AI-Uebergaenge: ${aiTransitions.join(', ')}`);
  }

  // 4. Kein Parallelismus (15 Punkte)
  const { found: hasParallelism, pattern: parallelPattern } = checkParallelism(text);
  if (!hasParallelism) {
    details.no_parallelism = 15;
  } else {
    details.no_parallelism = 0;
    flaggedPatterns.push(`Parallele Satzstruktur: "${parallelPattern}"`);
  }

  // 5. Blacklist clean (10 Punkte)
  const blacklistMatches = checkBlacklist(text);
  if (blacklistMatches.length === 0) {
    details.blacklist_clean = 10;
  } else {
    details.blacklist_clean = 0;
    flaggedPatterns.push(`Blacklist-Treffer: ${blacklistMatches.join(', ')}`);
  }

  // 6. Natuerliche Elemente (10 Punkte)
  const { hasNatural, missing: naturalMissing } = checkNaturalElements(text);
  if (hasNatural) {
    details.natural_elements = 10;
  } else {
    details.natural_elements = 0;
    flaggedPatterns.push(`Text zu perfekt: ${naturalMissing.join('; ')}`);
  }

  const score = Object.values(details).reduce((a, b) => a + b, 0);
  return { score, details, flaggedPatterns };
}

// --- humanizeText via Claude ---

export async function humanizeText(content: CoverLetterContent): Promise<{ content: CoverLetterContent; report: HumanizeReport }> {
  const original = [content.absatz_1, content.absatz_2, content.absatz_3, content.absatz_4].join('\n\n');
  const { score: originalScore, flaggedPatterns } = calculateHumanScore(original);

  const prompt = `Du bist ein Textoptimierer. Dieser Bewerbungstext klingt nach KI.

PROBLEME:
${flaggedPatterns.map((p) => `- ${p}`).join('\n')}

REGELN:
- Satzlaengen variieren (kurze 6-10 Woerter + lange 20-28 Woerter mischen)
- Max 25% der Saetze mit "Ich" starten
- KEINE AI-Uebergaenge: "Darueber hinaus", "Des Weiteren", "Insbesondere", "Vor diesem Hintergrund" etc.
- Parallele Satzstrukturen brechen
- Optional: ein Einschub in Klammern oder Gedankenstrich
- Schweizer Deutsch, kein Konjunktiv (wuerde, koennte, haette), keine Blacklist-Floskeln
- KEIN sz: Immer "ss"
- ABSOLUT KEINE Bindestriche (kein "-"): Schreibe "IT Service" statt "IT-Service", "Cloud Migration" statt "Cloud-Migration" etc.
- Gesamtlaenge: 180-280 Woerter
- Inhalt und Fakten NICHT veraendern, nur Struktur und Stil
- NICHTS ERFINDEN: Keine neuen Zahlen, Projekte oder Fakten hinzufuegen

ORIGINAL:
Absatz 1: ${content.absatz_1}
Absatz 2: ${content.absatz_2}
Absatz 3: ${content.absatz_3}
Absatz 4: ${content.absatz_4}

Antworte NUR mit JSON (keine Erklaerungen, kein Markdown):
{ "absatz_1": "...", "absatz_2": "...", "absatz_3": "...", "absatz_4": "..." }`;

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const responseText = await withRetry(async () => {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude API');
    return textBlock.text;
  });

  const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn(`Failed to parse humanizer response: ${cleaned.substring(0, 200)}`);
    return {
      content,
      report: { original, humanized: original, changes: ['Parse-Fehler bei Humanizer'], score: originalScore, flaggedPatterns },
    };
  }

  const humanized: CoverLetterContent = {
    betreff: content.betreff,
    anrede: content.anrede,
    absatz_1: parsed.absatz_1 || content.absatz_1,
    absatz_2: parsed.absatz_2 || content.absatz_2,
    absatz_3: parsed.absatz_3 || content.absatz_3,
    absatz_4: parsed.absatz_4 || content.absatz_4,
  };

  const humanizedText = [humanized.absatz_1, humanized.absatz_2, humanized.absatz_3, humanized.absatz_4].join('\n\n');

  // Re-check blacklist on humanized version
  const postBlacklist = checkBlacklist(humanizedText);
  if (postBlacklist.length > 0) {
    logger.warn(`Humanizer introduced blacklist violations: ${postBlacklist.join(', ')}`);
  }

  const { score: newScore, flaggedPatterns: newFlags } = calculateHumanScore(humanizedText);

  const changes: string[] = [];
  if (humanized.absatz_1 !== content.absatz_1) changes.push('Absatz 1 ueberarbeitet');
  if (humanized.absatz_2 !== content.absatz_2) changes.push('Absatz 2 ueberarbeitet');
  if (humanized.absatz_3 !== content.absatz_3) changes.push('Absatz 3 ueberarbeitet');
  if (humanized.absatz_4 !== content.absatz_4) changes.push('Absatz 4 ueberarbeitet');
  changes.push(`Score: ${originalScore} → ${newScore}`);

  logger.info(`Humanizer: score ${originalScore} → ${newScore}, ${changes.length - 1} paragraphs changed`);

  return {
    content: humanized,
    report: {
      original,
      humanized: humanizedText,
      changes,
      score: newScore,
      flaggedPatterns: newFlags,
    },
  };
}

// --- Original validateCoverLetter (unchanged) ---

export function validateCoverLetter(content: CoverLetterContent): ValidationResult {
  const violations: string[] = [];
  const fullText = [content.absatz_1, content.absatz_2, content.absatz_3, content.absatz_4].join(' ');

  // 1. Blacklist + Konjunktiv
  violations.push(...checkBlacklist(fullText));

  // 1b. Bindestriche
  const hyphens = checkHyphens(fullText);
  if (hyphens.length > 0) {
    violations.push(`Bindestriche gefunden: ${hyphens.join(', ')} — schreibe ohne Bindestrich`);
  }

  // 2. Satzanfaenge: nicht 3+ aufeinanderfolgende mit gleichem Wort
  violations.push(...checkSentenceStartVariety(fullText));

  // 3. Satzlaenge: Mix pruefen
  violations.push(...checkSentenceLengthVariance(fullText).violations);

  // 4. Wort-Wiederholungen: kein Nicht-Stopwort >3x
  violations.push(...checkWordRepetitions(fullText));

  // 5. Absatzlaenge: jeder 2-6 Saetze
  violations.push(...checkParagraphLength(content));

  // 6. Gesamtlaenge: 180-300 Woerter Body
  violations.push(...checkTotalWordCount(content));

  return { valid: violations.length === 0, violations };
}
