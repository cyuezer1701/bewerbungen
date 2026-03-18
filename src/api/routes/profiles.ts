import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getActiveSearchProfiles, insertSearchProfile, deactivateSearchProfile } from '../../db/queries.js';
import { getDb } from '../../db/index.js';

export const profilesRouter = Router();

// GET /api/search-profiles
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/search-profiles
profilesRouter.get('/', (_req, res) => {
  res.json(getActiveSearchProfiles());
});

// POST /api/search-profiles
// curl -X POST -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"name":"DevOps","keywords":"DevOps,Cloud Engineer","location":"Schweiz"}' http://localhost:3333/api/search-profiles
profilesRouter.post('/', (req, res) => {
  const { name, keywords, location, radius_km, min_match_score } = req.body;
  if (!name || !keywords) return res.status(400).json({ error: 'name and keywords required' });

  const id = uuidv4();
  insertSearchProfile({ id, name, keywords, location, radius_km, min_match_score });
  res.json({ id, name, keywords });
});

// PATCH /api/search-profiles/:id
// curl -X PATCH -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"keywords":"DevOps,SRE"}' http://localhost:3333/api/search-profiles/PROFILE_ID
profilesRouter.patch('/:id', (req, res) => {
  const db = getDb();
  const { name, keywords, location, radius_km, min_match_score } = req.body;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (keywords !== undefined) { updates.push('keywords = ?'); params.push(keywords); }
  if (location !== undefined) { updates.push('location = ?'); params.push(location); }
  if (radius_km !== undefined) { updates.push('radius_km = ?'); params.push(radius_km); }
  if (min_match_score !== undefined) { updates.push('min_match_score = ?'); params.push(min_match_score); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE search_profiles SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM search_profiles WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/search-profiles/:id
// curl -X DELETE -H "Authorization: Bearer TOKEN" http://localhost:3333/api/search-profiles/PROFILE_ID
profilesRouter.delete('/:id', (req, res) => {
  deactivateSearchProfile(req.params.id);
  res.json({ ok: true });
});
