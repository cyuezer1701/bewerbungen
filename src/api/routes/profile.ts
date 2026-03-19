import { Router } from 'express';
import { getCandidateProfile, upsertCandidateProfile, getActiveWishes } from '../../db/queries.js';
import { getStructuredCV } from '../../matching/cv-parser.js';
import { generateCandidateProfile } from '../../matching/candidate-profile.js';
import { getSearchKeywords, getExcludeKeywords } from '../../matching/search-strategy.js';
import { getSetting } from '../../db/settings.js';
import { logger } from '../../utils/logger.js';

export const profileRouter = Router();

// POST /api/profile/generate — Generate profile via Claude
profileRouter.post('/generate', async (_req, res) => {
  try {
    const cv = await getStructuredCV();
    const wishes = getActiveWishes();
    const profile = await generateCandidateProfile(cv, wishes);
    res.json(profile);
  } catch (err) {
    logger.error('Profile generation failed', { error: err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Generation failed' });
  }
});

// GET /api/profile — Get current profile
profileRouter.get('/', (_req, res) => {
  const profile = getCandidateProfile();
  if (!profile) return res.json({ exists: false });

  // Parse JSON fields for response
  let parsed: Record<string, unknown> = { exists: true };
  try {
    if (profile.raw_assessment) {
      parsed = { exists: true, ...JSON.parse(profile.raw_assessment) };
    }
  } catch {
    parsed = { exists: true, raw: profile };
  }
  parsed.generated_at = profile.generated_at;
  parsed.updated_at = profile.updated_at;
  res.json(parsed);
});

// PUT /api/profile/wishes — Update wishes text on profile
profileRouter.put('/wishes', (req, res) => {
  const { wishes } = req.body;
  if (wishes === undefined) return res.status(400).json({ error: 'wishes required' });
  upsertCandidateProfile({ wishes });
  res.json({ ok: true });
});

// GET /api/profile/search-strategy — Get keywords + source
profileRouter.get('/search-strategy', (_req, res) => {
  const { keywords, source } = getSearchKeywords();
  const excludeProfile = getExcludeKeywords();
  const excludeSettings = (getSetting('exclude_keywords') || '').split(',').map(k => k.trim()).filter(Boolean);
  // Show profile exclude keywords (editable here) separately from settings-only ones
  res.json({ keywords, source, exclude: excludeProfile, excludeFromSettings: excludeSettings });
});

// PATCH /api/profile/search-strategy — Manually override keywords
profileRouter.patch('/search-strategy', (req, res) => {
  // Accept both formats: { search_strategy: {...} } or direct { keywords, exclude, ... }
  const strategy = req.body.search_strategy || req.body;
  if (!strategy || (!strategy.keywords && !strategy.exclude)) {
    return res.status(400).json({ error: 'keywords or exclude required' });
  }

  // Load existing strategy and merge
  const profile = getCandidateProfile();
  let existing: Record<string, unknown> = {};
  if (profile?.search_strategy_keywords) {
    try { existing = JSON.parse(profile.search_strategy_keywords); } catch {}
  }

  // Build updated strategy: keep primary/secondary/opportunistic from AI, allow manual override of exclude + keywords
  const updated = {
    ...existing,
    ...(strategy.keywords !== undefined ? {
      primary: strategy.keywords.filter((_: string, i: number) => i < Math.ceil(strategy.keywords.length / 2)),
      secondary: strategy.keywords.filter((_: string, i: number) => i >= Math.ceil(strategy.keywords.length / 2)),
    } : {}),
    ...(strategy.exclude !== undefined ? { exclude: strategy.exclude } : {}),
  };

  upsertCandidateProfile({ search_strategy_keywords: JSON.stringify(updated) });
  res.json({ ok: true });
});
