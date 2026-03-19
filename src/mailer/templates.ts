import { getSetting } from '../db/settings.js';
import type { JobRow } from '../db/queries.js';

function buildAnrede(job: JobRow): string {
  if (job.contact_person && job.contact_gender === 'f') {
    const title = job.contact_title ? `${job.contact_title} ` : '';
    return `Sehr geehrte Frau ${title}${job.contact_person}`;
  }
  if (job.contact_person && job.contact_gender === 'm') {
    const title = job.contact_title ? `${job.contact_title} ` : '';
    return `Sehr geehrter Herr ${title}${job.contact_person}`;
  }
  return 'Sehr geehrte Damen und Herren';
}

function buildSubject(job: JobRow, senderName: string): string {
  let subject = `Bewerbung als ${job.title}`;
  if (job.reference_number) subject += ` (Ref: ${job.reference_number})`;
  subject += ` — ${senderName}`;
  return subject;
}

export function buildApplicationEmail(
  job: JobRow,
  senderName: string,
  senderEmail: string,
  senderPhone: string,
  originalRecipient?: string
): { subject: string; text: string; html: string } {
  const subject = buildSubject(job, senderName);
  const anrede = buildAnrede(job);

  const stelleRef = job.reference_number
    ? `${job.title} (Ref: ${job.reference_number})`
    : job.title;

  const testWarningText = originalRecipient
    ? `⚠️ Dies ist eine TEST-Bewerbung. Originalempfaenger waere: ${originalRecipient}\n\n---\n\n`
    : '';

  const testWarningHtml = originalRecipient
    ? `<div style="background: #f59e0b; color: #000; padding: 10px; margin-bottom: 20px; border-radius: 4px; font-weight: bold;">⚠️ TEST-BEWERBUNG — Originalempfaenger: ${originalRecipient}</div>`
    : '';

  const text = `${testWarningText}${anrede}

Gerne uebersende ich Ihnen meine Bewerbungsunterlagen fuer die Stelle als ${stelleRef}.

Im Anhang finden Sie mein Bewerbungsschreiben, meinen Lebenslauf sowie meine Arbeitszeugnisse.

Fuer Rueckfragen stehe ich Ihnen jederzeit gerne zur Verfuegung.

Freundliche Gruesse
${senderName}
${senderPhone}`;

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.6;">
${testWarningHtml}
<p>${anrede}</p>

<p>Gerne &uuml;bersende ich Ihnen meine Bewerbungsunterlagen f&uuml;r die Stelle als <strong>${stelleRef}</strong>.</p>

<p>Im Anhang finden Sie mein Bewerbungsschreiben, meinen Lebenslauf sowie meine Arbeitszeugnisse.</p>

<p>F&uuml;r R&uuml;ckfragen stehe ich Ihnen jederzeit gerne zur Verf&uuml;gung.</p>

<p>Freundliche Gr&uuml;sse<br>
${senderName}<br>
${senderPhone}</p>
</div>`;

  return { subject, text, html };
}
