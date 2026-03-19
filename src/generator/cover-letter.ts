import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { getSetting } from '../db/settings.js';
import { formatSwissDate } from './pdf-builder.js';
import { checkBlacklist } from './blacklist.js';
import type { JobRow } from '../db/queries.js';
import type { StructuredCV } from '../matching/cv-parser.js';
import type { CompanyResearch } from '../matching/company-research.js';

export interface RecipientAddress {
  companyFullName: string;
  contactPerson?: string;
  contactGender?: string;
  contactTitle?: string;
  department?: string;
  street: string;
  zip: string;
  city: string;
}

export function validateRecipientAddress(addr: RecipientAddress): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!addr.companyFullName) missing.push('Firmenname');
  if (!addr.street) missing.push('Strasse');
  if (!addr.zip) missing.push('PLZ');
  if (!addr.city) missing.push('Ort');
  return { valid: missing.length === 0, missing };
}

export function buildRecipientAddress(job: JobRow, research: CompanyResearch): RecipientAddress {
  return {
    companyFullName: research.company_full_name || job.company,
    contactPerson: job.contact_person || undefined,
    contactGender: job.contact_gender || undefined,
    contactTitle: job.contact_title || undefined,
    department: research.department || job.contact_department || undefined,
    street: research.street,
    zip: research.zip,
    city: research.city || job.location || '',
  };
}

function buildAnrede(addr: RecipientAddress): string {
  if (addr.contactPerson && addr.contactGender === 'f') {
    const title = addr.contactTitle ? `${addr.contactTitle} ` : '';
    return `Sehr geehrte Frau ${title}${addr.contactPerson}`;
  }
  if (addr.contactPerson && addr.contactGender === 'm') {
    const title = addr.contactTitle ? `${addr.contactTitle} ` : '';
    return `Sehr geehrter Herr ${title}${addr.contactPerson}`;
  }
  return 'Sehr geehrte Damen und Herren';
}

function buildBetreff(job: JobRow): string {
  let betreff = `Bewerbung als ${job.title}`;
  if (job.reference_number) betreff += ` (Ref: ${job.reference_number})`;
  return betreff;
}

const COVER_LETTER_PROMPT = `Du schreibst ein Bewerbungsschreiben fuer den Schweizer Arbeitsmarkt.
Du bist KEIN KI-Textgenerator. Du schreibst wie ein selbstbewusster Profi der genau weiss was er will.

KANDIDAT:
{cv}

JOB:
Titel: {title}
Firma: {company_full_name}
Ort: {location}
Beschreibung: {description}
Referenznummer: {reference_number}

FIRMENRECHERCHE:
{company_research}

KONTAKTPERSON:
{contact_person}
Geschlecht: {contact_gender}
Titel: {contact_title}

GEHALTSVORSTELLUNG IM INSERAT VERLANGT: {salary_requested}
{salary_info}

FOKUS-EMPFEHLUNG VOM MATCHING:
{focus}

FORMAT-REGELN (SCHWEIZER STANDARD):

Zeile 1-4 ABSENDER (oben rechts):
{absender}

Dann eine Leerzeile.

Zeile 6-10 EMPFAENGER (links):
{empfaenger_block}

Dann eine Leerzeile.

ORTSDATUM (rechts):
{ortsdatum}

Dann eine Leerzeile.

BETREFF (fett):
"{betreff}"

Dann eine Leerzeile.

ANREDE:
{anrede}

ABSATZ 1 — DER EINSTIEG (3-4 Saetze):
- VERBOT: Nicht mit "Hiermit bewerbe ich mich", "Mit grossem Interesse", "Ihre Stellenanzeige hat mich angesprochen", "Auf der Suche nach neuen Herausforderungen" oder aehnlichen Floskeln starten
- STATTDESSEN: Starte mit einem konkreten Bezug zur Firma. Nutze die Firmenrecherche. Beispiel: Ein aktuelles Projekt, eine News, eine strategische Richtung der Firma und warum genau DAS den Kandidaten anspricht
- Zeige dass der Kandidat die Firma KENNT und sich bewusst fuer sie entschieden hat

ABSATZ 2 — DER BEWEIS (4-5 Saetze):
- Nenne 2-3 konkrete Erfolge aus dem CV die DIREKT relevant fuer die Stelle sind
- JEDER Erfolg braucht eine ZAHL oder ein messbares Ergebnis
- Verknuepfe jeden Erfolg mit einer Anforderung aus der Stellenbeschreibung

ABSATZ 3 — DER MEHRWERT (3-4 Saetze):
- Was bringt der Kandidat mit das UEBER die Mindestanforderungen hinausgeht?
- Eigene Projekte als Beweis fuer Eigeninitiative und technische Tiefe
- Warum passt der Kandidat kulturell zur Firma? (Bezug auf culture_values aus Firmenrecherche)

ABSATZ 4 — DER SCHLUSS (2-3 Saetze):
{salary_instruction}
- Verfuegbarkeit: "Ich bin per {available_from} verfuegbar."
- Abschluss: "Ich freue mich auf ein persoenliches Gespraech." (Indikativ, kein Konjunktiv)

GRUSSFORMEL:
"Freundliche Gruesse" (NICHT "Mit freundlichen Gruessen" — das ist Deutschland, nicht Schweiz)

Dann eine Leerzeile.
{sender_name}

Dann eine Leerzeile.
BEILAGEN-VERMERK:
"Beilagen: Lebenslauf, Arbeitszeugnisse"

STRIKTE VERBOTE:
- KEIN Konjunktiv: Nicht "wuerde", "koennte", "moechte gerne", "haette". Immer Indikativ.
- KEIN sz: Immer "ss" (Schweizer Deutsch)
- KEINE Bindestriche: Sie wirken maschinell
- KEINE dieser Floskeln: "Hiermit bewerbe ich mich", "Mit grossem Interesse", "Ich bin ueberzeugt dass", "Ueber eine Einladung wuerde ich mich freuen", "Ich bin eine engagierte Persoenlichkeit", "Ich bringe mit", "Zu meinen Staerken zaehlen"
- KEIN Gehalt ausser es ist explizit verlangt (siehe oben)
- KEINE Aufzaehlungszeichen oder Bullet Points
- KEINE Emojis
- Das Anschreiben MUSS auf eine einzige A4-Seite passen. Halte dich kurz (200-280 Woerter).

SPRACHE:
- Deutsch, Schweizer Stil
- Selbstbewusst aber nicht arrogant
- Konkret statt vage
- Aktiv statt passiv ("Ich fuehrte" nicht "Es wurde von mir gefuehrt")
- Professionell aber menschlich, nicht roboterhaft

Antwort als reiner Text, bereit fuer PDF-Generierung. Keine Markdown-Formatierung.`;

export async function generateCoverLetter(
  job: JobRow,
  cv: StructuredCV,
  focus: string,
  companyResearch: CompanyResearch,
  feedback?: string
): Promise<string> {
  // Build sender address from settings
  const senderName = getSetting('sender_name') || cv.name;
  const senderStreet = getSetting('sender_address_street');
  const senderZip = getSetting('sender_address_zip');
  const senderCity = getSetting('sender_address_city');
  const senderPhone = getSetting('sender_phone');
  const senderEmail = getSetting('sender_email');
  const absenderLines = [senderName, senderStreet, [senderZip, senderCity].filter(Boolean).join(' '), senderPhone, senderEmail].filter(Boolean);
  const absender = absenderLines.join('\n');
  const datum = formatSwissDate();
  const ortsdatum = `${senderCity || 'Schweiz'}, ${datum}`;

  // Build recipient address
  const recipient = buildRecipientAddress(job, companyResearch);
  const empfaengerLines = [
    recipient.companyFullName,
    recipient.contactPerson
      ? (recipient.contactGender === 'f' ? 'Frau ' : recipient.contactGender === 'm' ? 'Herr ' : '') +
        (recipient.contactTitle ? `${recipient.contactTitle} ` : '') + recipient.contactPerson
      : (recipient.department || 'Personalabteilung'),
    recipient.street || undefined,
    [recipient.zip, recipient.city].filter(Boolean).join(' ') || undefined,
  ].filter(Boolean);
  const empfaengerBlock = empfaengerLines.join('\n');

  const anrede = buildAnrede(recipient);
  const betreff = buildBetreff(job);

  // Salary info
  const salaryRequested = job.salary_requested_in_posting ? 'Ja' : 'Nein';
  const salaryIdeal = getSetting('salary_expectation_ideal');
  const salaryCurrency = getSetting('salary_currency_default') || 'CHF';
  const salaryInfo = job.salary_requested_in_posting && salaryIdeal && salaryIdeal !== '0'
    ? `Gehaltsvorstellung des Kandidaten: ${salaryIdeal} ${salaryCurrency}`
    : '';
  const salaryInstruction = job.salary_requested_in_posting && salaryIdeal && salaryIdeal !== '0'
    ? `- NUR weil salary_requested == true: "Meine Gehaltsvorstellung liegt bei ${salaryCurrency} ${salaryIdeal} brutto pro Jahr."`
    : '- Gehalt wird NICHT erwaehnt (nicht im Inserat verlangt). KEIN Gehalt im Text.';

  const availableFrom = getSetting('sender_available_from') || 'sofort';

  // Company research JSON
  const researchJson = JSON.stringify(companyResearch, null, 2);

  let prompt = COVER_LETTER_PROMPT
    .replace('{cv}', JSON.stringify(cv, null, 2))
    .replace('{title}', job.title)
    .replace('{company_full_name}', companyResearch.company_full_name || job.company)
    .replace('{location}', job.location || 'nicht angegeben')
    .replace('{description}', job.description || 'keine Beschreibung')
    .replace('{reference_number}', job.reference_number || 'keine')
    .replace('{company_research}', researchJson)
    .replace('{contact_person}', job.contact_person || 'nicht bekannt')
    .replace('{contact_gender}', job.contact_gender || 'unknown')
    .replace('{contact_title}', job.contact_title || 'keiner')
    .replace('{salary_requested}', salaryRequested)
    .replace('{salary_info}', salaryInfo)
    .replace('{focus}', focus)
    .replace('{absender}', absender)
    .replace('{empfaenger_block}', empfaengerBlock)
    .replace('{ortsdatum}', ortsdatum)
    .replace('{betreff}', betreff)
    .replace('{anrede}', anrede)
    .replace('{salary_instruction}', salaryInstruction)
    .replace('{available_from}', availableFrom)
    .replace('{sender_name}', senderName);

  if (feedback) {
    prompt += `\n\nZUSAETZLICHES FEEDBACK VOM BEWERBER:\n${feedback}\n\nBitte beruecksichtige dieses Feedback bei der Ueberarbeitung.`;
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const maxRetries = 2;

  let text = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    text = await withRetry(async () => {
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

    // Check blacklist
    const blacklistMatches = checkBlacklist(text);
    if (blacklistMatches.length === 0) break;

    if (attempt < maxRetries) {
      logger.warn(`Blacklist matches found (attempt ${attempt + 1}): ${blacklistMatches.join(', ')}`);
      prompt += `\n\nWICHTIG: Das vorherige Anschreiben enthielt folgende verbotene Floskeln/Woerter. Ersetze sie ALLE:\n${blacklistMatches.map(m => `- "${m}"`).join('\n')}\n\nGeneriere das Anschreiben NEU ohne diese Floskeln.`;
    } else {
      logger.warn(`Blacklist matches still found after ${maxRetries} retries: ${blacklistMatches.join(', ')}`);
    }
  }

  logger.info(`Cover letter generated for "${job.title}" at ${job.company} (${text.split(/\s+/).length} words)`);
  return text;
}
