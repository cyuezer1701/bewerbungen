import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { parseCV, getStructuredCV } from '../../matching/cv-parser.js';

export const documentsRouter = Router();

const upload = multer({ dest: '/tmp/autobewerber-uploads/' });

// GET /api/documents — List all documents
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/documents
documentsRouter.get('/', (_req, res) => {
  const docs: Array<{ name: string; type: string; size: number; path: string }> = [];

  // CV
  if (fs.existsSync(config.CV_PATH)) {
    const stat = fs.statSync(config.CV_PATH);
    docs.push({ name: path.basename(config.CV_PATH), type: 'cv', size: stat.size, path: config.CV_PATH });
  }

  // Zeugnisse
  if (fs.existsSync(config.ZEUGNISSE_DIR)) {
    const files = fs.readdirSync(config.ZEUGNISSE_DIR).filter(f => f.endsWith('.pdf'));
    for (const file of files) {
      const filePath = path.join(config.ZEUGNISSE_DIR, file);
      const stat = fs.statSync(filePath);
      docs.push({ name: file, type: 'zeugnis', size: stat.size, path: filePath });
    }
  }

  res.json(docs);
});

// POST /api/documents/upload — Upload file
// curl -X POST -H "Authorization: Bearer TOKEN" -F "file=@cv.pdf" -F "type=cv" http://localhost:3333/api/documents/upload
documentsRouter.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const type = (req.body.type as string) || 'zeugnis';
  let destPath: string;

  if (type === 'cv') {
    destPath = config.CV_PATH;
  } else {
    fs.mkdirSync(config.ZEUGNISSE_DIR, { recursive: true });
    destPath = path.join(config.ZEUGNISSE_DIR, req.file.originalname);
  }

  fs.copyFileSync(req.file.path, destPath);
  fs.unlinkSync(req.file.path);

  logger.info(`Document uploaded: ${destPath}`);
  res.json({ ok: true, path: destPath, name: path.basename(destPath) });
});

// DELETE /api/documents/:filename — Delete document
// curl -X DELETE -H "Authorization: Bearer TOKEN" http://localhost:3333/api/documents/zeugnis_name.pdf
documentsRouter.delete('/:filename', (req, res) => {
  const filename = req.params.filename;

  // Check Zeugnisse dir
  const zeugPath = path.join(config.ZEUGNISSE_DIR, filename);
  if (fs.existsSync(zeugPath)) {
    fs.unlinkSync(zeugPath);
    return res.json({ ok: true, deleted: filename });
  }

  // Check if it's the CV
  if (path.basename(config.CV_PATH) === filename && fs.existsSync(config.CV_PATH)) {
    fs.unlinkSync(config.CV_PATH);
    return res.json({ ok: true, deleted: filename });
  }

  res.status(404).json({ error: 'File not found' });
});

// GET /api/documents/:filename — Download document
// curl -H "Authorization: Bearer TOKEN" http://localhost:3333/api/documents/cv.pdf -o cv.pdf
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
