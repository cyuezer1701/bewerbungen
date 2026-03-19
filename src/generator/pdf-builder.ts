import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { sanitizeFilename } from '../utils/sanitize.js';
import { getSetting } from '../db/settings.js';
import type { JobRow } from '../db/queries.js';
import type { StructuredCV } from '../matching/cv-parser.js';

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

function parseLetterParts(text: string): {
  absender: string;
  empfaenger: string;
  datum: string;
  betreff: string;
  inhalt: string;
} {
  const lines = text.split('\n');
  const parts = {
    absender: '',
    empfaenger: '',
    datum: '',
    betreff: '',
    inhalt: '',
  };

  // Strategy: find the "Betreff:" line as anchor, then split around it
  let betreffIndex = lines.findIndex((l) =>
    l.toLowerCase().startsWith('betreff') || l.toLowerCase().startsWith('bewerbung als')
  );

  if (betreffIndex === -1) {
    // Fallback: treat everything as content
    parts.inhalt = text;
    return parts;
  }

  // Everything before betreff: split into absender (top), then empfaenger
  const beforeBetreff = lines.slice(0, betreffIndex);

  // Find the date line (contains a date pattern or month name)
  const datePatterns = /(\d{1,2}\.\s?\w+\s?\d{4}|\d{1,2}\.\d{1,2}\.\d{4}|Januar|Februar|Maerz|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)/i;
  const dateIndex = beforeBetreff.findIndex((l) => datePatterns.test(l));

  if (dateIndex >= 0) {
    // Lines before date: could be absender, then empfaenger
    // Find the empty line that separates absender from empfaenger
    let separatorIndex = -1;
    for (let i = 0; i < dateIndex; i++) {
      if (beforeBetreff[i].trim() === '') {
        separatorIndex = i;
        break;
      }
    }

    if (separatorIndex >= 0) {
      parts.absender = beforeBetreff.slice(0, separatorIndex).join('<br>');
      parts.empfaenger = beforeBetreff.slice(separatorIndex + 1, dateIndex).join('<br>');
    } else {
      parts.empfaenger = beforeBetreff.slice(0, dateIndex).join('<br>');
    }

    parts.datum = beforeBetreff[dateIndex].trim();
  } else {
    parts.empfaenger = beforeBetreff.join('<br>');
  }

  // Betreff line
  parts.betreff = lines[betreffIndex].replace(/^betreff:\s*/i, '').trim();

  // Everything after betreff is the body
  const afterBetreff = lines.slice(betreffIndex + 1).join('\n').trim();

  // Convert paragraphs (double newline separated) to <p> tags
  parts.inhalt = afterBetreff
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.replace(/\n/g, ' ').trim()}</p>`)
    .join('\n');

  return parts;
}

export async function generateCoverLetterPDF(
  text: string,
  job: JobRow,
  cv: StructuredCV,
  outputDir: string
): Promise<string> {
  // Read HTML template (try dist/ first, then src/ for dev mode)
  let templatePath = path.resolve(__dirname, 'templates', 'cover-letter.html');
  if (!fs.existsSync(templatePath)) {
    templatePath = path.resolve(__dirname, '../../src/generator/templates/cover-letter.html');
  }
  let html = fs.readFileSync(templatePath, 'utf-8');

  // Strip markdown formatting (Claude sometimes adds ** despite instructions)
  text = text.replace(/\*\*/g, '').replace(/\*/g, '');

  // Parse the letter text into structured parts
  const parts = parseLetterParts(text);

  // If parsing didn't find structured parts, create them from settings + job data
  if (!parts.absender) {
    const name = getSetting('sender_name') || cv.name;
    const street = getSetting('sender_address_street');
    const zip = getSetting('sender_address_zip');
    const city = getSetting('sender_address_city');
    const country = getSetting('sender_address_country');
    const phone = getSetting('sender_phone');
    const email = getSetting('sender_email');
    const addressLines = [name, street, [zip, city].filter(Boolean).join(' '), country, phone, email].filter(Boolean);
    parts.absender = addressLines.join('<br>');
  }
  if (!parts.empfaenger) {
    parts.empfaenger = `${job.company}<br>${job.location || ''}`;
  }
  if (!parts.datum) {
    parts.datum = formatSwissDate();
  }
  if (!parts.betreff) {
    parts.betreff = `Bewerbung als ${job.title}`;
  }
  if (!parts.inhalt) {
    parts.inhalt = text
      .split(/\n\s*\n/)
      .map((p) => `<p>${p.replace(/\n/g, ' ').trim()}</p>`)
      .join('\n');
  }

  // Replace placeholders
  html = html
    .replace('{{absender}}', parts.absender)
    .replace('{{empfaenger}}', parts.empfaenger)
    .replace('{{datum}}', parts.datum)
    .replace('{{betreff}}', parts.betreff)
    .replace('{{inhalt}}', parts.inhalt);

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
      margin: {
        top: '2cm',
        bottom: '2cm',
        left: '2.5cm',
        right: '2.5cm',
      },
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
  coverLetterText: string,
  cv: StructuredCV
): Promise<{ pdfPath: string; fullPackagePath: string }> {
  // Create output directory
  const companySlug = sanitizeFilename(job.company);
  const dateStr = new Date().toISOString().slice(0, 10);
  const dirName = `${companySlug}_${dateStr}`;
  const outputDir = path.join(config.BEWERBUNGEN_DIR, dirName);
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate cover letter PDF
  const pdfPath = await generateCoverLetterPDF(coverLetterText, job, cv, outputDir);

  // Merge all PDFs
  const fullPackagePath = await mergeApplicationPDFs(pdfPath, outputDir, companySlug);

  return { pdfPath, fullPackagePath };
}
