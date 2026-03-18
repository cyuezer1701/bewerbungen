import type { Telegraf } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import {
  getActiveSearchProfiles,
  insertSearchProfile,
  deactivateSearchProfile,
  logActivity,
} from '../../db/queries.js';
import { config } from '../../config.js';

export function registerSearchHandlers(bot: Telegraf): void {
  bot.command('search', (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    const subcommand = parts[1];
    const args = parts.slice(2).join(' ');

    if (!subcommand || !['add', 'list', 'remove'].includes(subcommand)) {
      return ctx.reply('Usage:\n/search add <keywords>\n/search list\n/search remove <id>');
    }

    try {
      switch (subcommand) {
        case 'add': {
          if (!args) {
            return ctx.reply('Usage: /search add <keywords>\nBeispiel: /search add DevOps Engineer,Cloud Architect');
          }

          const id = uuidv4();
          insertSearchProfile({
            id,
            name: args.split(',')[0].trim(),
            keywords: args,
            location: config.JOB_SEARCH_LOCATION,
          });

          logActivity(null, null, 'search_profile_added', JSON.stringify({ id, keywords: args }));
          ctx.reply(`✅ Suchprofil erstellt:\n🔍 Keywords: ${args}\n📍 Standort: ${config.JOB_SEARCH_LOCATION}\n\nID: ${id.slice(0, 8)}`);
          break;
        }

        case 'list': {
          const profiles = getActiveSearchProfiles();

          if (profiles.length === 0) {
            return ctx.reply('Keine aktiven Suchprofile.\n\nDefault Keywords: ' + config.JOB_SEARCH_KEYWORDS);
          }

          let msg = '🔍 Aktive Suchprofile:\n\n';
          msg += `Default: ${config.JOB_SEARCH_KEYWORDS}\n\n`;

          for (const p of profiles) {
            msg += `📋 ${p.name}\n`;
            msg += `   Keywords: ${p.keywords}\n`;
            msg += `   Standort: ${p.location || config.JOB_SEARCH_LOCATION}\n`;
            msg += `   Min Score: ${p.min_match_score}\n`;
            msg += `   ID: ${p.id.slice(0, 8)}\n\n`;
          }

          ctx.reply(msg);
          break;
        }

        case 'remove': {
          if (!args) {
            return ctx.reply('Usage: /search remove <id>\nNutze /search list um IDs zu sehen.');
          }

          // Find profile by partial ID match
          const profiles = getActiveSearchProfiles();
          const profile = profiles.find((p) => p.id.startsWith(args));

          if (!profile) {
            return ctx.reply(`Suchprofil "${args}" nicht gefunden.`);
          }

          deactivateSearchProfile(profile.id);
          logActivity(null, null, 'search_profile_removed', JSON.stringify({ id: profile.id }));
          ctx.reply(`✅ Suchprofil "${profile.name}" deaktiviert.`);
          break;
        }
      }
    } catch (err) {
      logger.error('Error in /search command', { error: err });
      ctx.reply('Fehler bei der Suchprofilverwaltung.');
    }
  });
}
