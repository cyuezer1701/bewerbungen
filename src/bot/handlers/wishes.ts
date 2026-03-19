import type { Telegraf } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { getActiveWishes, insertWish, deactivateWish } from '../../db/queries.js';
import type { CandidateWishRow } from '../../db/queries.js';

function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('gehalt') || lower.includes('lohn') || lower.includes('salär') || lower.includes('chf') || lower.includes('eur') || /\d{2,3}k/.test(lower)) return 'gehalt';
  if (lower.includes('remote') || lower.includes('homeoffice') || lower.includes('home office') || lower.includes('hybrid')) return 'arbeitsmodell';
  if (lower.includes('branche') || lower.includes('industrie') || lower.includes('pharma') || lower.includes('bank') || lower.includes('versicherung')) return 'branche';
  if (lower.includes('kein') || lower.includes('nicht') || lower.includes('ohne') || lower.includes('vermeide')) return 'ausschluss';
  if (lower.includes('ort') || lower.includes('stadt') || lower.includes('zürich') || lower.includes('zuerich') || lower.includes('bern') || lower.includes('basel')) return 'standort';
  if (lower.includes('firma') || lower.includes('unternehmen') || lower.includes('startup') || lower.includes('konzern')) return 'firmentyp';
  if (lower.includes('rolle') || lower.includes('position') || lower.includes('titel') || lower.includes('lead') || lower.includes('manager')) return 'rolle';
  return 'general';
}

function formatWishes(wishes: CandidateWishRow[]): string {
  if (wishes.length === 0) return 'Keine aktiven Wuensche vorhanden.';

  const grouped = new Map<string, CandidateWishRow[]>();
  for (const w of wishes) {
    const existing = grouped.get(w.category) || [];
    existing.push(w);
    grouped.set(w.category, existing);
  }

  const priorityIcon: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' };
  let msg = '📋 Aktive Wuensche:\n\n';
  for (const [category, items] of grouped) {
    msg += `📁 ${category.charAt(0).toUpperCase() + category.slice(1)}:\n`;
    for (const w of items) {
      const icon = priorityIcon[w.priority] || '⚪';
      const idPrefix = w.id.substring(0, 8);
      msg += `  ${icon} ${w.wish} (${idPrefix})\n`;
    }
    msg += '\n';
  }
  return msg;
}

export function registerWishHandlers(bot: Telegraf): void {
  // /wish <text> — Add a wish
  bot.command('wish', async (ctx) => {
    const args = ctx.message.text.replace(/^\/wish\s*/, '').trim();

    if (!args) {
      return ctx.reply('Usage:\n/wish <dein Wunsch>\n/wish remove <id-prefix>\n/wishes — Alle anzeigen');
    }

    // /wish remove <id-prefix>
    if (args.startsWith('remove ')) {
      const prefix = args.replace('remove ', '').trim();
      const wishes = getActiveWishes();
      const match = wishes.find((w) => w.id.startsWith(prefix));
      if (!match) {
        return ctx.reply(`Kein Wunsch mit ID "${prefix}" gefunden.`);
      }
      deactivateWish(match.id);
      return ctx.reply(`✅ Wunsch deaktiviert: "${match.wish}"`);
    }

    // Add new wish
    const category = detectCategory(args);
    const id = uuidv4();
    try {
      insertWish({ id, category, wish: args });
      ctx.reply(`✅ Wunsch gespeichert!\n📁 Kategorie: ${category}\n📝 ${args}\n\nID: ${id.substring(0, 8)}`);
    } catch (err) {
      logger.error('Failed to save wish', { error: err });
      ctx.reply('Fehler beim Speichern des Wunsches.');
    }
  });

  // /wishes — List active wishes
  bot.command('wishes', async (ctx) => {
    try {
      const wishes = getActiveWishes();
      ctx.reply(formatWishes(wishes));
    } catch (err) {
      logger.error('Failed to list wishes', { error: err });
      ctx.reply('Fehler beim Laden der Wuensche.');
    }
  });
}
