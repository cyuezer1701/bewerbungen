import type { Telegraf } from 'telegraf';
import { logger } from '../../utils/logger.js';
import { getJobById } from '../../db/queries.js';
import { updateResearchAddress, getCachedResearch, saveResearch } from '../../matching/company-research.js';
import type { CompanyResearch } from '../../matching/company-research.js';

export function registerAddressHandlers(bot: Telegraf): void {
  // /address <job_id> <strasse>, <plz> <ort>
  bot.command('address', async (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply(
        'Usage: /address <job-id> <strasse>, <plz> <ort>\n' +
        'Beispiel: /address abc123 Mythenquai 2, 8002 Zürich'
      );
    }

    const jobId = parts[1];
    const job = getJobById(jobId);
    if (!job) {
      return ctx.reply(`Job "${jobId}" nicht gefunden.`);
    }

    // Parse address: everything after job_id
    const addressStr = parts.slice(2).join(' ');
    const commaIdx = addressStr.indexOf(',');
    if (commaIdx === -1) {
      return ctx.reply(
        'Format: <strasse>, <plz> <ort>\n' +
        'Beispiel: Mythenquai 2, 8002 Zürich'
      );
    }

    const street = addressStr.slice(0, commaIdx).trim();
    const rest = addressStr.slice(commaIdx + 1).trim();
    const zipCityMatch = rest.match(/^(\d{4,5})\s+(.+)$/);
    if (!zipCityMatch) {
      return ctx.reply(
        'PLZ und Ort nicht erkannt. Format: <strasse>, <plz> <ort>\n' +
        'Beispiel: Mythenquai 2, 8002 Zürich'
      );
    }

    const zip = zipCityMatch[1];
    const city = zipCityMatch[2];

    try {
      updateResearchAddress(job.company, street, zip, city);
      logger.info(`Address updated for ${job.company}: ${street}, ${zip} ${city}`);
      await ctx.reply(
        `✅ Adresse für ${job.company} aktualisiert:\n` +
        `${street}\n${zip} ${city}\n\n` +
        `Nutze /apply ${jobId} um die Bewerbung zu generieren.`
      );
    } catch (err) {
      logger.error('Error updating address', { error: err });
      await ctx.reply('Fehler beim Speichern der Adresse.');
    }
  });

  // /setup name | strasse | plz ort | telefon | email
  bot.command('setup', async (ctx) => {
    const text = ctx.message.text.replace(/^\/setup\s*/, '');
    if (!text) {
      return ctx.reply(
        'Absender-Daten einrichten:\n\n' +
        '/setup Max Muster | Musterstrasse 12 | 8000 Zürich | +41 XX XXX XX XX | max@email.com\n\n' +
        'Oder richte alles im Dashboard ein.'
      );
    }

    const segments = text.split('|').map(s => s.trim());
    if (segments.length < 5) {
      return ctx.reply(
        'Bitte alle 5 Felder angeben (getrennt mit |):\n' +
        'Name | Strasse | PLZ Ort | Telefon | E-Mail'
      );
    }

    const [name, street, plzOrt, phone, email] = segments;
    const plzMatch = plzOrt.match(/^(\d{4,5})\s+(.+)$/);
    if (!plzMatch) {
      return ctx.reply('PLZ und Ort nicht erkannt. Format: 8000 Zürich');
    }

    const { setSetting } = await import('../../db/settings.js');
    setSetting('sender_name', name);
    setSetting('sender_address_street', street);
    setSetting('sender_address_zip', plzMatch[1]);
    setSetting('sender_address_city', plzMatch[2]);
    setSetting('sender_phone', phone);
    setSetting('sender_email', email);

    logger.info(`Sender setup complete: ${name}, ${street}, ${plzMatch[1]} ${plzMatch[2]}`);
    await ctx.reply(
      `✅ Absender-Daten gespeichert:\n\n` +
      `${name}\n${street}\n${plzMatch[1]} ${plzMatch[2]}\n${phone}\n${email}\n\n` +
      `Du kannst jetzt Bewerbungen generieren.`
    );
  });
}
