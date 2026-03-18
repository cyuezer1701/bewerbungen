import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

export interface StructuredCV {
  name: string;
  current_role: string;
  years_experience: number;
  skills_technical: string[];
  skills_soft: string[];
  certifications: string[];
  languages: Array<{ language: string; level: string }>;
  industries: string[];
  education: Array<{ degree: string; institution: string; year: string }>;
  work_history: Array<{
    role: string;
    company: string;
    duration: string;
    highlights: string[];
  }>;
  key_achievements: string[];
  preferred_roles: string[];
  salary_expectation: string;
  location_preference: string;
}

const CV_PARSE_PROMPT = `Du bist ein CV-Analyst. Extrahiere aus dem folgenden Lebenslauf eine strukturierte JSON-Repräsentation.

Antwort NUR als JSON, kein Markdown, keine Backticks:
{
    "name": "...",
    "current_role": "...",
    "years_experience": 0,
    "skills_technical": ["..."],
    "skills_soft": ["..."],
    "certifications": ["..."],
    "languages": [{"language": "...", "level": "..."}],
    "industries": ["..."],
    "education": [{"degree": "...", "institution": "...", "year": "..."}],
    "work_history": [{"role": "...", "company": "...", "duration": "...", "highlights": ["..."]}],
    "key_achievements": ["..."],
    "preferred_roles": ["..."],
    "salary_expectation": "...",
    "location_preference": "..."
}`;

function getHashPath(): string {
  return path.resolve(path.dirname(config.CV_PATH), 'cv-hash.txt');
}

function getCachePath(): string {
  return path.resolve(path.dirname(config.CV_PATH), 'cv-structured.json');
}

function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseJsonResponse(text: string): unknown {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

export async function parseCV(): Promise<StructuredCV> {
  logger.info('Parsing CV from PDF...');

  if (!fs.existsSync(config.CV_PATH)) {
    throw new Error(`CV file not found at ${config.CV_PATH}`);
  }

  // Dynamic import for pdf-parse (CommonJS module)
  const pdfParse = (await import('pdf-parse')).default;
  const pdfBuffer = fs.readFileSync(config.CV_PATH);
  const pdfData = await pdfParse(pdfBuffer);
  const cvText = pdfData.text;

  logger.info(`CV parsed: ${cvText.length} characters extracted from PDF`);

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const result = await withRetry(async () => {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `${CV_PARSE_PROMPT}\n\nLEBENSLAUF:\n${cvText}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude API');
    }

    return parseJsonResponse(textBlock.text) as StructuredCV;
  });

  // Cache the result
  const cachePath = getCachePath();
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf-8');

  // Store hash of the PDF
  const hash = computeFileHash(config.CV_PATH);
  fs.writeFileSync(getHashPath(), hash, 'utf-8');

  logger.info(`CV structured and cached at ${cachePath}`);
  return result;
}

export async function getStructuredCV(): Promise<StructuredCV> {
  const cachePath = getCachePath();
  const hashPath = getHashPath();

  // If cache exists, check if PDF has changed
  if (fs.existsSync(cachePath)) {
    // If no PDF exists, just use the cache (dummy data scenario)
    if (!fs.existsSync(config.CV_PATH)) {
      logger.info('Using cached cv-structured.json (no PDF found)');
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as StructuredCV;
    }

    // Compare hash
    const currentHash = computeFileHash(config.CV_PATH);
    if (fs.existsSync(hashPath)) {
      const storedHash = fs.readFileSync(hashPath, 'utf-8').trim();
      if (currentHash === storedHash) {
        logger.info('Using cached cv-structured.json (PDF unchanged)');
        return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as StructuredCV;
      }
    }

    logger.info('CV PDF has changed, re-parsing...');
  }

  // If no PDF exists and no cache, error
  if (!fs.existsSync(config.CV_PATH)) {
    throw new Error(
      `Neither CV PDF (${config.CV_PATH}) nor cached structured CV (${cachePath}) found`
    );
  }

  return parseCV();
}
