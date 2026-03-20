import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';
import { getSetting } from '../db/settings.js';
import { getJobBySourceId } from '../db/queries.js';
import type { ScrapedJob } from './base-scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function execPython(scriptPath: string, input: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [scriptPath], { timeout: 120_000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Python exited with code ${code}: ${stderr}`));
    });
    proc.on('error', reject);
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

interface JobSpyResult {
  title: string;
  company: string;
  location: string;
  description: string;
  source: string;
  sourceId: string;
  sourceUrl: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  datePosted: string | null;
  isRemote: boolean;
}

export async function runJobSpy(
  keywords: string[],
  location: string,
  maxJobs: number
): Promise<ScrapedJob[]> {
  // Resolve bridge script (works from both src and dist)
  let scriptPath = path.resolve(__dirname, '../../scripts/jobspy-bridge.py');
  if (!scriptPath.includes('/scripts/')) {
    scriptPath = path.resolve(process.cwd(), 'scripts/jobspy-bridge.py');
  }

  const sites = (getSetting('jobspy_sites') || 'indeed,glassdoor,google')
    .split(',').map(s => s.trim()).filter(Boolean);
  const country = getSetting('jobspy_country') || 'Switzerland';

  // Split multi-location (e.g. "Basel, Zuerich") into individual searches
  const locations = location.includes(',')
    ? location.split(',').map(l => `${l.trim()}, ${country}`)
    : [`${location}, ${country}`];

  const payload = JSON.stringify({
    keywords: keywords.slice(0, 5),
    locations,
    max_results: maxJobs,
    sites,
    hours_old: parseInt(getSetting('jobspy_hours_old') || '72', 10),
    country,
  });

  logger.info(`JobSpy: searching ${keywords.slice(0, 5).join(', ')} in ${locations.join(' + ')} on ${sites.join(', ')}`);

  try {
    const { stdout, stderr } = await execPython(scriptPath, payload);

    if (stderr) {
      for (const line of stderr.split('\n').filter(Boolean)) {
        logger.warn(`JobSpy stderr: ${line}`);
      }
    }

    const results: JobSpyResult[] = JSON.parse(stdout);
    logger.info(`JobSpy: received ${results.length} raw results`);

    const jobs: ScrapedJob[] = [];
    for (const r of results) {
      if (!r.title || !r.sourceId) continue;

      // Map JobSpy source names to our source types
      const source = mapSource(r.source);

      // Skip if already in DB
      if (getJobBySourceId(source, r.sourceId)) continue;

      const salaryRange = r.salaryMin && r.salaryMax
        ? `${r.salaryCurrency} ${r.salaryMin} - ${r.salaryMax}`
        : undefined;

      jobs.push({
        sourceId: r.sourceId,
        source,
        title: r.title,
        company: r.company || 'Unbekannt',
        location: r.isRemote ? `${r.location || ''} (Remote)`.trim() : (r.location || ''),
        description: r.description || '',
        sourceUrl: r.sourceUrl || '',
        salaryRange,
        postedAt: r.datePosted || undefined,
        applicationMethod: 'portal',
        applicationUrl: r.sourceUrl || undefined,
      });
    }

    logger.info(`JobSpy: ${jobs.length} new jobs after dedup`);
    return jobs;
  } catch (err) {
    logger.error('JobSpy bridge failed', { error: err });
    return [];
  }
}

function mapSource(site: string): ScrapedJob['source'] {
  switch (site.toLowerCase()) {
    case 'indeed': return 'indeed';
    case 'linkedin': return 'linkedin';
    case 'glassdoor': return 'glassdoor';
    case 'google': return 'google';
    default: return 'indeed'; // fallback
  }
}
