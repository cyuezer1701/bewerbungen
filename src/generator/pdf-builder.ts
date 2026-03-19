import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { sanitizeFilename } from '../utils/sanitize.js';
import type { JobRow } from '../db/queries.js';
import type { CoverLetterData } from './cover-letter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function formatSwissDate(): string {
  const formatter = new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
  const parts = formatter.formatToParts(new Date());
  const day = parts.find((p) => p.type === 'day')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const year = parts.find((p) => p.type === 'year')!.value;
  return `${day}. ${MONTHS_DE[parseInt(month, 10) - 1]} ${year}`;
}

export async function generateCoverLetterPDF(
  data: CoverLetterData,
  job: JobRow,
  outputDir: string
): Promise<string> {
  // Read HTML template (try dist/ first, then src/ for dev mode)
  let templatePath = path.resolve(__dirname, 'templates', 'cover-letter.html');
  if (!fs.existsSync(templatePath)) {
    templatePath = path.resolve(__dirname, '../../src/generator/templates/cover-letter.html');
  }
  let html = fs.readFileSync(templatePath, 'utf-8');

  // Build absender HTML
  const absenderLines = [
    data.sender.name,
    data.sender.street,
    [data.sender.zip, data.sender.city].filter(Boolean).join(' '),
    data.sender.phone,
    data.sender.email,
  ].filter(Boolean);
  const absenderHtml = absenderLines.join('<br>');

  // Build empfaenger HTML
  const empfaengerLines = [
    data.recipient.companyFullName,
    data.recipient.contactPerson
      ? (data.recipient.contactGender === 'f' ? 'Frau ' : data.recipient.contactGender === 'm' ? 'Herr ' : '') +
        (data.recipient.contactTitle ? `${data.recipient.contactTitle} ` : '') + data.recipient.contactPerson
      : (data.recipient.department || 'Personalabteilung'),
    data.recipient.street || undefined,
    [data.recipient.zip, data.recipient.city].filter(Boolean).join(' ') || undefined,
  ].filter(Boolean);
  const empfaengerHtml = empfaengerLines.join('<br>');

  // Replace all 10 placeholders
  html = html
    .replace('{{absender}}', absenderHtml)
    .replace('{{empfaenger}}', empfaengerHtml)
    .replace('{{ortsdatum}}', data.ortsdatum)
    .replace('{{betreff}}', data.content.betreff)
    .replace('{{anrede}}', data.content.anrede)
    .replace('{{absatz_1}}', data.content.absatz_1)
    .replace('{{absatz_2}}', data.content.absatz_2)
    .replace('{{absatz_3}}', data.content.absatz_3)
    .replace('{{absatz_4}}', data.content.absatz_4)
    .replace('{{sender_name}}', data.senderName);

  // Generate PDF with Puppeteer
  const launchOpts: Record<string, unknown> = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    // On ARM64, Puppeteer's bundled Chrome is x86-only. Use Playwright's Chrome if available.
    try {
      const base = path.join(homedir(), '.cache', 'ms-playwright');
      const dirs = fs.readdirSync(base).filter(d => d.startsWith('chromium-')).sort();
      if (dirs.length > 0) {
        const chromePath = path.join(base, dirs[dirs.length - 1], 'chrome-linux', 'chrome');
        if (fs.existsSync(chromePath)) {
          launchOpts.executablePath = chromePath;
        }
      }
    } catch {
      // Playwright not installed, let Puppeteer try its default
    }
  }
  const browser = await puppeteer.launch(launchOpts);

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const companySlug = sanitizeFilename(job.company);
    const pdfFilename = `anschreiben_${companySlug}.pdf`;
    const pdfPath = path.join(outputDir, pdfFilename);

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
    });

    logger.info(`Cover letter PDF generated: ${pdfPath}`);
    return pdfPath;
  } finally {
    await browser.close();
  }
}

async function addPdfToDoc(mergedDoc: PDFDocument, filePath: string, label: string): Promise<void> {
  try {
    const bytes = fs.readFileSync(filePath);
    const doc = await PDFDocument.load(bytes);
    const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
    for (const page of pages) {
      mergedDoc.addPage(page);
    }
    logger.info(`${label} added: ${path.basename(filePath)}`);
  } catch (err) {
    logger.warn(`Failed to add ${label} ${path.basename(filePath)}`, { error: err });
  }
}

function getDocumentsByCategory(category: string): string[] {
  // Try DB first for ordered documents
  try {
    const { getDb } = require('../db/index.js');
    const db = getDb();
    const rows = db.prepare(
      'SELECT filename FROM documents WHERE category = ? ORDER BY document_date DESC, sort_order ASC'
    ).all(category) as Array<{ filename: string }>;
    if (rows.length > 0) {
      return rows
        .map(r => path.join(config.ZEUGNISSE_DIR, r.filename))
        .filter(p => fs.existsSync(p));
    }
  } catch {
    // DB not available or table doesn't exist yet
  }
  return [];
}

function getPdfFilesFromDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort()
    .map(f => path.join(dirPath, f));
}

export async function mergeApplicationPDFs(
  coverLetterPath: string,
  outputDir: string,
  companySlug: string
): Promise<string> {
  const mergedDoc = await PDFDocument.create();

  // 1. Bewerbungsschreiben (generiert)
  await addPdfToDoc(mergedDoc, coverLetterPath, 'Cover letter');

  // 2. Lebenslauf (cv.pdf)
  if (fs.existsSync(config.CV_PATH)) {
    await addPdfToDoc(mergedDoc, config.CV_PATH, 'CV');
  } else {
    logger.info('No CV PDF found, skipping in merge');
  }

  // 3. Arbeitszeugnisse (neuestes zuerst)
  const zeugnisse = getDocumentsByCategory('zeugnis');
  if (zeugnisse.length > 0) {
    for (const file of zeugnisse) {
      await addPdfToDoc(mergedDoc, file, 'Zeugnis');
    }
  } else if (fs.existsSync(config.ZEUGNISSE_DIR)) {
    // Fallback: read all PDFs from zeugnisse directory
    const files = getPdfFilesFromDir(config.ZEUGNISSE_DIR);
    for (const file of files) {
      await addPdfToDoc(mergedDoc, file, 'Zeugnis');
    }
  }

  // 4. Diplome und Zertifikate
  const diplome = getDocumentsByCategory('diplom');
  for (const file of diplome) {
    await addPdfToDoc(mergedDoc, file, 'Diplom');
  }

  // 5. Weiterbildungsnachweise
  const weiterbildungen = getDocumentsByCategory('weiterbildung');
  for (const file of weiterbildungen) {
    await addPdfToDoc(mergedDoc, file, 'Weiterbildung');
  }

  // Save merged PDF
  const mergedFilename = `komplett_${companySlug}.pdf`;
  const mergedPath = path.join(outputDir, mergedFilename);
  const mergedBytes = await mergedDoc.save();
  fs.writeFileSync(mergedPath, mergedBytes);

  logger.info(`Merged PDF generated: ${mergedPath} (${mergedDoc.getPageCount()} pages)`);
  return mergedPath;
}

export async function generateApplicationPackage(
  job: JobRow,
  coverLetterData: CoverLetterData
): Promise<{ pdfPath: string; fullPackagePath: string }> {
  // Create output directory
  const companySlug = sanitizeFilename(job.company);
  const dateStr = new Date().toISOString().slice(0, 10);
  const dirName = `${companySlug}_${dateStr}`;
  const outputDir = path.join(config.BEWERBUNGEN_DIR, dirName);
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate cover letter PDF
  const pdfPath = await generateCoverLetterPDF(coverLetterData, job, outputDir);

  // Merge all PDFs
  const fullPackagePath = await mergeApplicationPDFs(pdfPath, outputDir, companySlug);

  return { pdfPath, fullPackagePath };
}
