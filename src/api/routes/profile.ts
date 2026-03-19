import { Router } from 'express';
import { getCandidateProfile, upsertCandidateProfile, getActiveWishes } from '../../db/queries.js';
import { getStructuredCV } from '../../matching/cv-parser.js';
import { generateCandidateProfile } from '../../matching/candidate-profile.js';
import { getSearchKeywords, getExcludeKeywords } from '../../matching/search-strategy.js';
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
  const exclude = getExcludeKeywords();
  res.json({ keywords, source, exclude });
});

// PATCH /api/profile/search-strategy — Manually override keywords
profileRouter.patch('/search-strategy', (req, res) => {
  const { search_strategy } = req.body;
  if (!search_strategy) return res.status(400).json({ error: 'search_strategy required' });
  upsertCandidateProfile({ search_strategy_keywords: JSON.stringify(search_strategy) });
  res.json({ ok: true });
});
