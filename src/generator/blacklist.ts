export const COVER_LETTER_BLACKLIST = [
  'hiermit bewerbe ich mich',
  'mit grossem interesse',
  'mit grosser begeisterung',
  'ihre stellenanzeige hat mich angesprochen',
  'auf der suche nach neuen herausforderungen',
  'ich bin überzeugt',
  'ich bin davon überzeugt',
  'über eine einladung würde ich mich freuen',
  'über eine einladung zu einem persönlichen gespräch',
  'ich bin eine engagierte persönlichkeit',
  'ich bin eine motivierte persönlichkeit',
  'zu meinen stärken zählen',
  'ich bringe mit',
  'ich verfüge über',
  'in der anlage finden sie',
  'anbei finden sie',
  'ich möchte gerne',
  'ich würde mich freuen',
  'ich könnte mir vorstellen',
  'würde gerne',
  'hätte grosses interesse',
  'mit freundlichen grüssen',
  // Leere Phrasen und KI-typische Formulierungen
  'war ein voller erfolg',
  'bringen zusaetzlichen mehrwert',
  'bringt zusaetzlichen mehrwert',
  'zusaetzlichen mehrwert',
  'passt perfekt zu',
  'aktiv mitgestalten',
  'fundierte expertise',
  'wertvolle erfahrungen',
  'der naechste logische schritt',
  'perfekt zu ihrer',
  'konsequent auf',
  'einen echten mehrwert',
  'ideale ergaenzung',
  'bringe ich die ideale',
  // Swiss-Spelling Varianten (Claude schreibt manchmal ue statt ü)
  'ich bin ueberzeugt',
  'ueber eine einladung wuerde ich mich freuen',
  'ueber eine einladung',
  'ich wuerde mich freuen',
  'ich koennte mir vorstellen',
  'wuerde gerne',
  'haette grosses interesse',
];

export const KONJUNKTIV_PATTERNS = [
  /\bwürde\b/gi,
  /\bkönnte\b/gi,
  /\bmöchte gerne\b/gi,
  /\bhätte\b/gi,
  // Swiss-Spelling Varianten
  /\bwuerde\b/gi,
  /\bkoennte\b/gi,
  /\bhaette\b/gi,
];

export const AI_TRANSITION_PHRASES = [
  'darüber hinaus',
  'darueber hinaus',
  'des weiteren',
  'insbesondere',
  'in diesem zusammenhang',
  'vor diesem hintergrund',
  'nicht zuletzt',
  'darauf aufbauend',
  'in meiner funktion als',
  'im rahmen meiner tätigkeit',
  'im rahmen meiner taetigkeit',
  'massgeblich dazu beigetragen',
  'einen wesentlichen beitrag',
  'konnte ich erfolgreich',
  'zeichne ich mich aus durch',
  'rundet mein profil ab',
  'ergänzt wird dies durch',
  'ergaenzt wird dies durch',
];

export function checkAiTransitions(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const phrase of AI_TRANSITION_PHRASES) {
    if (lower.includes(phrase)) {
      found.push(phrase);
    }
  }
  return found;
}

// Common hyphenated compound words that should be written without hyphens
const HYPHEN_PATTERNS = [
  /\bIT-\w+/g,
  /\bCloud-\w+/g,
  /\bTeam-\w+/g,
  /\bService-\w+/g,
  /\bProjekt-\w+/g,
  /\bSystem-\w+/g,
  /\bEnd-to-End/gi,
  /\bOn-Premise/gi,
];

export function checkHyphens(text: string): string[] {
  const found: string[] = [];
  for (const pattern of HYPHEN_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  return found;
}

export function checkBlacklist(text: string): string[] {
  const lower = text.toLowerCase();
  const matches: string[] = [];

  for (const phrase of COVER_LETTER_BLACKLIST) {
    if (lower.includes(phrase)) {
      matches.push(phrase);
    }
  }

  for (const pattern of KONJUNKTIV_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      matches.push(`Konjunktiv: "${m[0]}"`);
    }
  }

  return matches;
}
