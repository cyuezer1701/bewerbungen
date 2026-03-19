import { logger } from '../utils/logger.js';
import {
  getUnmatchedJobs,
  updateJobMatchScore,
  updateJobSalaryEstimate,
  updateJobStatus,
  logActivity,
  getActiveWishes,
  getCandidateProfile,
  getOutcomeSummary,
  getOutcomeTotal,
  getRecentApplicationsByCompany,
  normalizeCompany,
} from '../db/queries.js';
import { getStructuredCV } from './cv-parser.js';
import { scoreJob } from './job-scorer.js';
import { assessJobAsRecruiter } from './ai-recruiter.js';
import { loadCandidateProfile } from './candidate-profile.js';
import { config } from '../config.js';
import { getSetting } from '../db/settings.js';
import type { JobMatchResult } from './job-scorer.js';
import type { RecruiterAssessment } from './ai-recruiter.js';

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

  // Check if AI Recruiter is enabled
  const useRecruiter = getSetting('ai_recruiter_enabled') !== 'false';
  const profile = useRecruiter ? loadCandidateProfile() : null;
  const wishes = useRecruiter ? getActiveWishes() : [];

  // Load outcome summary for learning loop (only if enough data)
  const outcomeTotal = useRecruiter ? getOutcomeTotal() : 0;
  const outcomeSummary = outcomeTotal >= 5 ? getOutcomeSummary() : undefined;

  if (useRecruiter) {
    logger.info(`AI Recruiter active (profile: ${profile ? 'yes' : 'no'}, wishes: ${wishes.length}, outcomes: ${outcomeTotal})`);
  }

  let scored = 0;

  // Score sequentially to avoid Claude API rate limits (30k tokens/min)
  for (const job of jobs) {
    try {
      let result: JobMatchResult | RecruiterAssessment;

      if (useRecruiter) {
        // Check for duplicate company applications
        const companyNorm = (job as { company_normalized?: string }).company_normalized || normalizeCompany(job.company);
        const companyApps = getRecentApplicationsByCompany(companyNorm);

        result = await assessJobAsRecruiter(job, cv, profile, wishes, outcomeSummary, companyApps.length > 0 ? companyApps : undefined);
      } else {
        result = await scoreJob(job, cv);
      }

      // Update match score
      updateJobMatchScore(job.id, result.match_score, result.reasoning);

      // Update salary estimate
      if (result.salary_estimate) {
        updateJobSalaryEstimate(
          job.id,
          result.salary_estimate.min,
          result.salary_estimate.max,
          result.salary_estimate.realistic,
          result.salary_estimate.currency,
          result.salary_estimate.reasoning
        );
      }

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
          // Recruiter-specific fields
          ...('recruiter_verdict' in result ? {
            recruiter_verdict: result.recruiter_verdict,
            career_direction: result.career_assessment?.direction,
            wish_fulfillment_score: result.wish_fulfillment?.score,
            red_flags: result.red_flags,
            recruiter_note: result.recruiter_note,
          } : {}),
        }));
        scored++;
        continue;
      }

      // Update status based on recommendation and score
      if (result.recommendation === 'skip' || result.match_score < config.JOB_MIN_MATCH_SCORE) {
        updateJobStatus(job.id, 'reviewed');
      }

      // Log activity with extended fields
      logActivity(job.id, null, 'matched', JSON.stringify({
        match_score: result.match_score,
        recommendation: result.recommendation,
        salary_realistic: result.salary_estimate.realistic,
        salary_currency: result.salary_estimate.currency,
        matching_skills: result.matching_skills,
        missing_skills: result.missing_skills,
        cover_letter_focus: result.cover_letter_focus,
        // Recruiter-specific fields
        ...('recruiter_verdict' in result ? {
          recruiter_verdict: result.recruiter_verdict,
          career_direction: result.career_assessment?.direction,
          career_explanation: result.career_assessment?.explanation,
          wish_fulfillment_score: result.wish_fulfillment?.score,
          wishes_fulfilled: result.wish_fulfillment?.fulfilled,
          wishes_unfulfilled: result.wish_fulfillment?.unfulfilled,
          red_flags: result.red_flags,
          recruiter_note: result.recruiter_note,
        } : {}),
      }));

      scored++;
    } catch (err) {
      logger.error(`Failed to score job "${job.title}" at ${job.company}`, { error: err });
    }

    // Wait between API calls to respect rate limits
    if (scored < jobs.length) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info(`Matching complete: ${scored}/${jobs.length} jobs scored${useRecruiter ? ' (AI Recruiter)' : ''}`);
  return scored;
}
