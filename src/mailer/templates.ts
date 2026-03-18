import type { JobRow } from '../db/queries.js';

export function buildApplicationEmail(
  job: JobRow,
  senderName: string,
  senderEmail: string
): { subject: string; text: string; html: string } {
  const subject = `Bewerbung als ${job.title}`;

  const text = `Sehr geehrte Damen und Herren

Anbei erhalten Sie meine vollstaendigen Bewerbungsunterlagen fuer die ausgeschriebene Stelle als ${job.title}.

Die Unterlagen umfassen mein Bewerbungsschreiben, meinen Lebenslauf sowie relevante Zeugnisse und Zertifikate.

Ich freue mich auf Ihre Rueckmeldung und stehe fuer Rueckfragen jederzeit gerne zur Verfuegung.

Freundliche Gruesse
${senderName}
${senderEmail}`;

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.6;">
<p>Sehr geehrte Damen und Herren</p>

<p>Anbei erhalten Sie meine vollstaendigen Bewerbungsunterlagen fuer die ausgeschriebene Stelle als <strong>${job.title}</strong>.</p>

<p>Die Unterlagen umfassen mein Bewerbungsschreiben, meinen Lebenslauf sowie relevante Zeugnisse und Zertifikate.</p>

<p>Ich freue mich auf Ihre Rueckmeldung und stehe fuer Rueckfragen jederzeit gerne zur Verfuegung.</p>

<p>Freundliche Gruesse<br>
${senderName}<br>
${senderEmail}</p>
</div>`;

  return { subject, text, html };
}
