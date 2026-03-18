import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { sanitizeFilename } from '../utils/sanitize.js';
import type { JobRow } from '../db/queries.js';
import type { StructuredCV } from '../matching/cv-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  // Parse the letter text into structured parts
  const parts = parseLetterParts(text);

  // If parsing didn't find structured parts, create them from CV + job data
  if (!parts.absender) {
    parts.absender = `${cv.name}<br>${cv.location_preference || ''}`;
  }
  if (!parts.empfaenger) {
    parts.empfaenger = `${job.company}<br>${job.location || ''}`;
  }
  if (!parts.datum) {
    const now = new Date();
    const months = ['Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    parts.datum = `${now.getDate()}. ${months[now.getMonth()]} ${now.getFullYear()}`;
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

export async function mergeApplicationPDFs(
  coverLetterPath: string,
  outputDir: string,
  companySlug: string
): Promise<string> {
  const mergedDoc = await PDFDocument.create();

  // 1. Add cover letter
  const coverLetterBytes = fs.readFileSync(coverLetterPath);
  const coverLetterDoc = await PDFDocument.load(coverLetterBytes);
  const coverPages = await mergedDoc.copyPages(coverLetterDoc, coverLetterDoc.getPageIndices());
  for (const page of coverPages) {
    mergedDoc.addPage(page);
  }

  // 2. Add CV if exists
  if (fs.existsSync(config.CV_PATH)) {
    try {
      const cvBytes = fs.readFileSync(config.CV_PATH);
      const cvDoc = await PDFDocument.load(cvBytes);
      const cvPages = await mergedDoc.copyPages(cvDoc, cvDoc.getPageIndices());
      for (const page of cvPages) {
        mergedDoc.addPage(page);
      }
      logger.info('CV added to merged PDF');
    } catch (err) {
      logger.warn('Failed to add CV to merged PDF', { error: err });
    }
  } else {
    logger.info('No CV PDF found, skipping in merge');
  }

  // 3. Add Zeugnisse if directory exists and has files
  if (fs.existsSync(config.ZEUGNISSE_DIR)) {
    const zeugnisFiles = fs.readdirSync(config.ZEUGNISSE_DIR)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .sort();

    for (const file of zeugnisFiles) {
      try {
        const filePath = path.join(config.ZEUGNISSE_DIR, file);
        const bytes = fs.readFileSync(filePath);
        const doc = await PDFDocument.load(bytes);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        for (const page of pages) {
          mergedDoc.addPage(page);
        }
        logger.info(`Zeugnis added: ${file}`);
      } catch (err) {
        logger.warn(`Failed to add Zeugnis ${file}`, { error: err });
      }
    }
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
