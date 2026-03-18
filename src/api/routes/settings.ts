import { Router } from 'express';
import { getAllSettingsMasked, setSetting, getSettingsSchema } from '../../db/settings.js';

export const settingsRouter = Router();

// GET /api/settings — All settings (sensitive values masked)
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/settings
settingsRouter.get('/', (_req, res) => {
  res.json(getAllSettingsMasked());
});

// PUT /api/settings — Update settings
// curl -X PUT -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"min_match_score":"70","search_location":"Zuerich"}' http://localhost:3333/api/settings
settingsRouter.put('/', (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  let count = 0;
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      setSetting(key, String(value));
      count++;
    }
  }

  res.json({ ok: true, updated: count });
});

// GET /api/settings/schema — Setting definitions
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/settings/schema
settingsRouter.get('/schema', (_req, res) => {
  res.json(getSettingsSchema());
});
