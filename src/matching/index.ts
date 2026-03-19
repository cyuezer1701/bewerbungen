import { logger } from '../utils/logger.js';
import {
  getUnmatchedJobs,
  updateJobMatchScore,
  updateJobSalaryEstimate,
  updateJobStatus,
  logActivity,
} from '../db/queries.js';
import { getStructuredCV } from './cv-parser.js';
import { scoreJob } from './job-scorer.js';
import { config } from '../config.js';
import { getSetting } from '../db/settings.js';

export async function runMatching(): Promise<number> {
  logger.info('Starting job matching...');

  // Get structured CV
  let cv;
  try {
    cv = await getStructuredCV();
  } catch (err) {
    logger.error('Failed to load structured CV', { error: err });
    return 0;
  }

  // Get unscored jobs
  const jobs = getUnmatchedJobs();
  if (jobs.length === 0) {
    logger.info('No unmatched jobs to score');
    return 0;
  }

  logger.info(`Scoring ${jobs.length} unmatched jobs...`);

  let scored = 0;
  const scoringPromises = jobs.map(async (job) => {
    try {
      const result = await scoreJob(job, cv);

      // Update match score
      updateJobMatchScore(job.id, result.match_score, result.reasoning);

      // Update salary estimate
      updateJobSalaryEstimate(
        job.id,
        result.salary_estimate.min,
        result.salary_estimate.max,
        result.salary_estimate.realistic,
        result.salary_estimate.currency,
        result.salary_estimate.reasoning
      );

      // Salary filter: skip jobs below minimum salary
      const minSalary = parseInt(getSetting('minimum_salary') || '0', 10);
      if (minSalary > 0 && result.salary_estimate.realistic > 0
          && result.salary_estimate.realistic < minSalary) {
        updateJobStatus(job.id, 'reviewed');
        logActivity(job.id, null, 'matched', JSON.stringify({
          match_score: result.match_score,
          recommendation: result.recommendation,
          salary_realistic: result.salary_estimate.realistic,
          salary_currency: result.salary_estimate.currency,
          matching_skills: result.matching_skills,
          missing_skills: result.missing_skills,
          cover_letter_focus: result.cover_letter_focus,
          filtered_reason: 'salary_below_minimum',
        }));
        scored++;
        return;
      }

      // Update status based on recommendation and score
      if (result.recommendation === 'skip' || result.match_score < config.JOB_MIN_MATCH_SCORE) {
        updateJobStatus(job.id, 'reviewed');
      }

      // Log activity
      logActivity(job.id, null, 'matched', JSON.stringify({
        match_score: result.match_score,
        recommendation: result.recommendation,
        salary_realistic: result.salary_estimate.realistic,
        salary_currency: result.salary_estimate.currency,
        matching_skills: result.matching_skills,
        missing_skills: result.missing_skills,
        cover_letter_focus: result.cover_letter_focus,
      }));

      scored++;
    } catch (err) {
      logger.error(`Failed to score job "${job.title}" at ${job.company}`, { error: err });
    }
  });

  await Promise.all(scoringPromises);

  logger.info(`Matching complete: ${scored}/${jobs.length} jobs scored`);
  return scored;
}
