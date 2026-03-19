import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { getSetting } from '../db/settings.js';
import { formatSwissDate } from './pdf-builder.js';
import { validateCoverLetter } from './humanizer.js';
import type { JobRow } from '../db/queries.js';
import type { StructuredCV } from '../matching/cv-parser.js';
import type { CompanyResearch } from '../matching/company-research.js';

// --- Interfaces ---

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

export interface SenderAddress {
  name: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  phone: string;
  email: string;
}

export interface CoverLetterContent {
  betreff: string;
  anrede: string;
  absatz_1: string;
  absatz_2: string;
  absatz_3: string;
  absatz_4: string;
}

export interface CoverLetterData {
  content: CoverLetterContent;
  sender: SenderAddress;
  recipient: RecipientAddress;
  datum: string;
  ortsdatum: string;
  senderName: string;
}

// --- Bestehende Helper ---

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

export function buildAnrede(addr: RecipientAddress): string {
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

export function buildBetreff(job: JobRow): string {
  let betreff = `Bewerbung als ${job.title}`;
  if (job.reference_number) betreff += ` (Ref: ${job.reference_number})`;
  return betreff;
}

// --- Storage Format ---

export function formatCoverLetterForStorage(data: CoverLetterData): string {
  return [
    data.content.anrede, '',
    data.content.absatz_1, '',
    data.content.absatz_2, '',
    data.content.absatz_3, '',
    data.content.absatz_4, '',
    'Freundliche Grüsse', '',
    data.senderName,
  ].join('\n');
}

// --- JSON-only Prompt ---

const COVER_LETTER_PROMPT = `Du schreibst den INHALT eines Bewerbungsschreibens fuer den Schweizer Arbeitsmarkt.
Du bist KEIN KI-Textgenerator. Du schreibst wie ein selbstbewusster Profi der genau weiss was er will.

WICHTIG: Du lieferst NUR den Textinhalt als JSON. KEIN Layout, KEINE Adressen, KEIN Datum, KEINE Grussformel, KEINE Beilagen.

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

STRIKTE VERBOTE:
- KEIN Konjunktiv: Nicht "wuerde", "koennte", "moechte gerne", "haette". Immer Indikativ.
- KEIN sz: Immer "ss" (Schweizer Deutsch)
- KEINE Bindestriche: Sie wirken maschinell
- KEINE dieser Floskeln: "Hiermit bewerbe ich mich", "Mit grossem Interesse", "Ich bin ueberzeugt dass", "Ueber eine Einladung wuerde ich mich freuen", "Ich bin eine engagierte Persoenlichkeit", "Ich bringe mit", "Zu meinen Staerken zaehlen"
- KEIN Gehalt ausser es ist explizit verlangt (siehe oben)
- KEINE Aufzaehlungszeichen oder Bullet Points
- KEINE Emojis
- Der Gesamttext (alle 4 Absaetze) MUSS 180-280 Woerter haben. Halte dich kurz.

SPRACHE:
- Deutsch, Schweizer Stil
- Selbstbewusst aber nicht arrogant
- Konkret statt vage
- Aktiv statt passiv ("Ich fuehrte" nicht "Es wurde von mir gefuehrt")
- Professionell aber menschlich, nicht roboterhaft

Antworte AUSSCHLIESSLICH mit diesem JSON (keine Erklaerungen, kein Markdown):
{
  "absatz_1": "...",
  "absatz_2": "...",
  "absatz_3": "...",
  "absatz_4": "..."
}`;

// --- Main Generator ---

export async function generateCoverLetter(
  job: JobRow,
  cv: StructuredCV,
  focus: string,
  companyResearch: CompanyResearch,
  feedback?: string
): Promise<CoverLetterData> {
  // Build sender address from settings
  const senderName = getSetting('sender_name') || cv.name;
  const senderStreet = getSetting('sender_address_street') || '';
  const senderZip = getSetting('sender_address_zip') || '';
  const senderCity = getSetting('sender_address_city') || '';
  const senderCountry = getSetting('sender_address_country') || '';
  const senderPhone = getSetting('sender_phone') || '';
  const senderEmail = getSetting('sender_email') || '';

  const sender: SenderAddress = {
    name: senderName,
    street: senderStreet,
    zip: senderZip,
    city: senderCity,
    country: senderCountry,
    phone: senderPhone,
    email: senderEmail,
  };

  const datum = formatSwissDate();
  const ortsdatum = `${senderCity || 'Schweiz'}, ${datum}`;

  // Build recipient address
  const recipient = buildRecipientAddress(job, companyResearch);
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
    .replace('{salary_instruction}', salaryInstruction)
    .replace('{available_from}', availableFrom);

  if (feedback) {
    prompt += `\n\nZUSAETZLICHES FEEDBACK VOM BEWERBER:\n${feedback}\n\nBitte beruecksichtige dieses Feedback bei der Ueberarbeitung.`;
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const maxRetries = 2;

  let content: CoverLetterContent | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const responseText = await withRetry(async () => {
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

    // Parse JSON response (strip backticks if present)
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.warn(`Failed to parse cover letter JSON (attempt ${attempt + 1}): ${cleaned.substring(0, 200)}`);
      if (attempt < maxRetries) {
        prompt += '\n\nWICHTIG: Deine letzte Antwort war kein valides JSON. Antworte NUR mit dem JSON-Objekt, keine Erklaerungen.';
        continue;
      }
      throw new Error('Cover letter generation failed: invalid JSON response after retries');
    }

    // Build content with our own anrede/betreff (ignore Claude's if provided)
    content = {
      betreff: betreff,
      anrede: anrede,
      absatz_1: parsed.absatz_1 || '',
      absatz_2: parsed.absatz_2 || '',
      absatz_3: parsed.absatz_3 || '',
      absatz_4: parsed.absatz_4 || '',
    };

    // Validate with humanizer
    const validation = validateCoverLetter(content);
    if (validation.valid) break;

    if (attempt < maxRetries) {
      logger.warn(`Humanizer violations (attempt ${attempt + 1}): ${validation.violations.join(', ')}`);
      prompt += `\n\nWICHTIG: Das vorherige Anschreiben hatte folgende Probleme. Behebe sie ALLE:\n${validation.violations.map(v => `- ${v}`).join('\n')}\n\nGeneriere die 4 Absaetze NEU als JSON.`;
    } else {
      logger.warn(`Humanizer violations still found after ${maxRetries} retries: ${validation.violations.join(', ')}`);
    }
  }

  if (!content) {
    throw new Error('Cover letter generation failed: no content after retries');
  }

  const coverLetterData: CoverLetterData = {
    content,
    sender,
    recipient,
    datum,
    ortsdatum,
    senderName,
  };

  const bodyText = [content.absatz_1, content.absatz_2, content.absatz_3, content.absatz_4].join(' ');
  logger.info(`Cover letter generated for "${job.title}" at ${job.company} (${bodyText.split(/\s+/).length} words)`);

  return coverLetterData;
}
