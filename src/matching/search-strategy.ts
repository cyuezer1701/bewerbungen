import { logger } from '../utils/logger.js';
import { getSetting } from '../db/settings.js';
import { getCandidateProfile, getActiveSearchProfiles } from '../db/queries.js';
import { config } from '../config.js';

export function getSearchKeywords(): { keywords: string[]; source: string } {
  // 1. Check candidate_profile for AI-generated search strategy
  const profile = getCandidateProfile();
  let aiKeywords: string[] = [];

  if (profile?.search_strategy_keywords) {
    try {
      const strategy = JSON.parse(profile.search_strategy_keywords);
      aiKeywords = [
        ...(strategy.primary || []),
        ...(strategy.secondary || []),
        ...(strategy.opportunistic || []),
      ];
    } catch {
      logger.warn('Failed to parse search strategy from candidate profile');
    }
  }

  // 2. Manual keywords from settings + search_profiles
  const settingsKeywords = getSetting('search_keywords');
  const defaultKeywords = (settingsKeywords || config.JOB_SEARCH_KEYWORDS).split(',').map((k) => k.trim()).filter(Boolean);
  const profiles = getActiveSearchProfiles();
  const profileKeywords = profiles.flatMap((p) => p.keywords.split(',').map((k) => k.trim()).filter(Boolean));
  const manualKeywords = [...new Set([...defaultKeywords, ...profileKeywords])];

  // 3. Merge: AI keywords + manual (deduplicated)
  if (aiKeywords.length > 0) {
    const allKeywords = [...new Set([...aiKeywords, ...manualKeywords])];
    return { keywords: allKeywords, source: `AI-Profil (${aiKeywords.length}) + manuell (${manualKeywords.length})` };
  }

  return { keywords: manualKeywords, source: 'manuell (Settings + Suchprofile)' };
}

export function getExcludeKeywords(): string[] {
  const profile = getCandidateProfile();
  if (!profile?.search_strategy_keywords) return [];

  try {
    const strategy = JSON.parse(profile.search_strategy_keywords);
    return strategy.exclude || [];
  } catch {
    return [];
  }
}
