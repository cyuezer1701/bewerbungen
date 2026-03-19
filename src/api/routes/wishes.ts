import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getActiveWishes, getAllWishes, insertWish, updateWish, deactivateWish } from '../../db/queries.js';

export const wishesRouter = Router();

// GET /api/wishes — List active wishes
wishesRouter.get('/', (_req, res) => {
  const wishes = getActiveWishes();
  res.json({ data: wishes, total: wishes.length });
});

// POST /api/wishes — Create new wish
wishesRouter.post('/', (req, res) => {
  const { category, wish, priority } = req.body;
  if (!wish) return res.status(400).json({ error: 'wish required' });

  const id = uuidv4();
  insertWish({ id, category: category || 'general', wish, priority: priority || 'medium' });
  res.status(201).json({ id, category: category || 'general', wish, priority: priority || 'medium', is_active: 1 });
});

// PATCH /api/wishes/:id — Update wish
wishesRouter.patch('/:id', (req, res) => {
  const { category, wish, priority, is_active } = req.body;
  updateWish(req.params.id, { category, wish, priority, is_active });
  res.json({ ok: true });
});

// DELETE /api/wishes/:id — Deactivate wish
wishesRouter.delete('/:id', (req, res) => {
  deactivateWish(req.params.id);
  res.json({ ok: true });
});
