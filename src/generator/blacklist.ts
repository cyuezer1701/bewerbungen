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
