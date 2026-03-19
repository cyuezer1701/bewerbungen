import { checkBlacklist } from './blacklist.js';
import type { CoverLetterContent } from './cover-letter.js';

export interface ValidationResult {
  valid: boolean;
  violations: string[];
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

function checkSentenceLengthVariance(text: string): string[] {
  const violations: string[] = [];
  const sentences = splitSentences(text);
  if (sentences.length < 3) return violations;

  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
  const stddev = Math.sqrt(variance);

  if (stddev < 3) {
    violations.push(`Satzlaengen zu einheitlich (Standardabweichung: ${stddev.toFixed(1)}, erwartet >= 3)`);
  }

  return violations;
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

export function validateCoverLetter(content: CoverLetterContent): ValidationResult {
  const violations: string[] = [];
  const fullText = [content.absatz_1, content.absatz_2, content.absatz_3, content.absatz_4].join(' ');

  // 1. Blacklist + Konjunktiv
  violations.push(...checkBlacklist(fullText));

  // 2. Satzanfaenge: nicht 3+ aufeinanderfolgende mit gleichem Wort
  violations.push(...checkSentenceStartVariety(fullText));

  // 3. Satzlaenge: Mix pruefen
  violations.push(...checkSentenceLengthVariance(fullText));

  // 4. Wort-Wiederholungen: kein Nicht-Stopwort >3x
  violations.push(...checkWordRepetitions(fullText));

  // 5. Absatzlaenge: jeder 2-6 Saetze
  violations.push(...checkParagraphLength(content));

  // 6. Gesamtlaenge: 180-300 Woerter Body
  violations.push(...checkTotalWordCount(content));

  return { valid: violations.length === 0, violations };
}
