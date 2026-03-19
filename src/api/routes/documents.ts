import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { parseCV, getStructuredCV } from '../../matching/cv-parser.js';
import { getDb } from '../../db/index.js';

export const documentsRouter = Router();

const upload = multer({ dest: '/tmp/autobewerber-uploads/' });

// GET /api/documents — List all documents
documentsRouter.get('/', (_req, res) => {
  const docs: Array<{ id?: string; name: string; type: string; size: number; path: string; category?: string; document_date?: string; sort_order?: number }> = [];

  // CV
  if (fs.existsSync(config.CV_PATH)) {
    const stat = fs.statSync(config.CV_PATH);
    docs.push({ name: path.basename(config.CV_PATH), type: 'cv', size: stat.size, path: config.CV_PATH });
  }

  // Check DB for categorized documents
  try {
    const db = getDb();
    const dbDocs = db.prepare('SELECT * FROM documents ORDER BY category, sort_order, document_date DESC').all() as Array<{
      id: string; filename: string; original_name: string; category: string;
      document_date: string | null; sort_order: number; file_size: number | null;
    }>;
    for (const doc of dbDocs) {
      const filePath = path.join(config.ZEUGNISSE_DIR, doc.filename);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        docs.push({
          id: doc.id,
          name: doc.original_name,
          type: doc.category,
          size: stat.size,
          path: filePath,
          category: doc.category,
          document_date: doc.document_date || undefined,
          sort_order: doc.sort_order,
        });
      }
    }
  } catch {
    // DB table might not exist yet; fall back to filesystem
  }

  // Filesystem fallback: Zeugnisse not in DB
  if (fs.existsSync(config.ZEUGNISSE_DIR)) {
    const dbFilenames = new Set(docs.filter(d => d.id).map(d => path.basename(d.path)));
    const files = fs.readdirSync(config.ZEUGNISSE_DIR).filter(f => f.endsWith('.pdf'));
    for (const file of files) {
      if (dbFilenames.has(file)) continue;
      const filePath = path.join(config.ZEUGNISSE_DIR, file);
      const stat = fs.statSync(filePath);
      docs.push({ name: file, type: 'zeugnis', size: stat.size, path: filePath });
    }
  }

  res.json(docs);
});

// POST /api/documents/upload — Upload file
documentsRouter.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const type = (req.body.type as string) || 'zeugnis';
  const category = (req.body.category as string) || type;
  const documentDate = (req.body.document_date as string) || null;
  let destPath: string;

  if (type === 'cv') {
    destPath = config.CV_PATH;
  } else {
    fs.mkdirSync(config.ZEUGNISSE_DIR, { recursive: true });
    destPath = path.join(config.ZEUGNISSE_DIR, req.file.originalname);
  }

  fs.copyFileSync(req.file.path, destPath);
  fs.unlinkSync(req.file.path);

  // Track in DB (for non-CV documents)
  if (type !== 'cv') {
    try {
      const db = getDb();
      const id = uuidv4();
      db.prepare(`
        INSERT OR REPLACE INTO documents (id, filename, original_name, category, document_date, file_size, mime_type)
        VALUES (?, ?, ?, ?, ?, ?, 'application/pdf')
      `).run(id, req.file.originalname, req.file.originalname, category, documentDate, req.file.size);
    } catch (err) {
      logger.warn('Failed to track document in DB', { error: err });
    }
  }

  logger.info(`Document uploaded: ${destPath} (category: ${category})`);
  res.json({ ok: true, path: destPath, name: path.basename(destPath), category });
});

// PATCH /api/documents/:id — Update document metadata (category, date, order)
documentsRouter.patch('/:id', (req, res) => {
  const { category, document_date, sort_order } = req.body;
  try {
    const db = getDb();
    const updates: string[] = [];
    const params: unknown[] = [];
    if (category) { updates.push('category = ?'); params.push(category); }
    if (document_date !== undefined) { updates.push('document_date = ?'); params.push(document_date); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

// DELETE /api/documents/:filename — Delete document
documentsRouter.delete('/:filename', (req, res) => {
  const filename = req.params.filename;

  // Check Zeugnisse dir
  const zeugPath = path.join(config.ZEUGNISSE_DIR, filename);
  if (fs.existsSync(zeugPath)) {
    fs.unlinkSync(zeugPath);
    // Remove from DB
    try {
      const db = getDb();
      db.prepare('DELETE FROM documents WHERE filename = ?').run(filename);
    } catch { /* ignore */ }
    return res.json({ ok: true, deleted: filename });
  }

  // Check if it's the CV
  if (path.basename(config.CV_PATH) === filename && fs.existsSync(config.CV_PATH)) {
    fs.unlinkSync(config.CV_PATH);
    return res.json({ ok: true, deleted: filename });
  }

  res.status(404).json({ error: 'File not found' });
});

// GET /api/documents/cv-structured
documentsRouter.get('/cv-structured', async (_req, res) => {
  try {
    const cv = await getStructuredCV();
    res.json(cv);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'CV not found' });
  }
});

documentsRouter.post('/reparse-cv', async (_req, res) => {
  try {
    const cv = await parseCV();
    res.json(cv);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Parse failed' });
  }
});

documentsRouter.get('/:filename', (req, res) => {
  const filename = req.params.filename;

  const zeugPath = path.join(config.ZEUGNISSE_DIR, filename);
  if (fs.existsSync(zeugPath)) return res.download(zeugPath);

  if (path.basename(config.CV_PATH) === filename && fs.existsSync(config.CV_PATH)) {
    return res.download(config.CV_PATH);
  }

  res.status(404).json({ error: 'File not found' });
});
