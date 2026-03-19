import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { getSetting } from '../db/settings.js';
import { scoringSemaphore } from './job-scorer.js';
import type { SalaryEstimate } from './job-scorer.js';
import type { JobRow } from '../db/queries.js';
import type { StructuredCV } from './cv-parser.js';
import type { CandidateProfile } from './candidate-profile.js';
import type { CandidateWishRow } from '../db/queries.js';

export interface RecruiterAssessment {
  // Backward-compat with JobMatchResult
  match_score: number;
  reasoning: string;
  matching_skills: string[];
  missing_skills: string[];
  salary_estimate: SalaryEstimate;
  recommendation: 'apply' | 'maybe' | 'skip';
  cover_letter_focus: string;
  // New recruiter fields
  recruiter_verdict: string;
  career_assessment: {
    direction: 'aufstieg' | 'seitwaerts' | 'rueckschritt';
    explanation: string;
  };
  wish_fulfillment: {
    fulfilled: string[];
    unfulfilled: string[];
    score: number;
  };
  red_flags: string[];
  recruiter_note: string;
}

function formatWishesForPrompt(wishes: CandidateWishRow[]): string {
  if (wishes.length === 0) return 'Keine spezifischen Wuensche.';
  return wishes.map((w) => `- [${w.priority}] ${w.wish}`).join('\n');
}

function getAggressivenessInstruction(): string {
  const level = getSetting('ai_recruiter_aggressiveness') || 'balanced';
  switch (level) {
    case 'conservative':
      return 'Sei STRENG. Empfehle nur Jobs die wirklich perfekt passen. Lieber ein guter Job weniger als ein falscher zu viel.';
    case 'aggressive':
      return 'Sei OFFEN. Auch wenn nicht alles passt, koennte es eine Chance sein. Empfehle grosszuegig, der Kandidat entscheidet selbst.';
    default:
      return 'Sei AUSGEWOGEN. Empfehle Jobs die gut passen, aber sei offen fuer interessante Seitwaerrts-Schritte.';
  }
}

function buildRecruiterPrompt(
  job: JobRow,
  cv: StructuredCV,
  profile: CandidateProfile | null,
  wishes: CandidateWishRow[]
): string {
  const aggressiveness = getAggressivenessInstruction();

  const profileSection = profile
    ? `KANDIDATEN-PROFIL (vom Headhunter erstellt):
Karrierepfad: ${profile.career_trajectory}
Staerken: ${JSON.stringify(profile.strengths)}
Alleinstellungsmerkmale: ${JSON.stringify(profile.usps)}
Vermeiden: ${JSON.stringify(profile.avoid_roles)}
Ideale Firmen: ${profile.ideal_companies}
Gehaltseinschaetzung: ${profile.salary_insight}`
    : 'Kein tiefes Profil vorhanden — nutze den Lebenslauf direkt.';

  return `Du bist der persoenliche Executive Recruiter dieses Kandidaten. Du kennst ihn seit Jahren und weisst genau was er will und kann.

${aggressiveness}

LEBENSLAUF:
${JSON.stringify(cv, null, 2)}

${profileSection}

WUENSCHE DES KANDIDATEN:
${formatWishesForPrompt(wishes)}

JOB:
Titel: ${job.title}
Firma: ${job.company}
Ort: ${job.location || 'nicht angegeben'}
Beschreibung: ${job.description || 'keine Beschreibung'}
Gehalt laut Inserat: ${job.salary_range || 'nicht angegeben'}
Bewerbungsweg: ${job.application_method || 'nicht angegeben'}

Bewerte als Recruiter:
1. Passt dieser Job in den KARRIEREPFAD des Kandidaten?
2. Ist das ein AUFSTIEG, SEITWAERTS-Schritt oder RUECKSCHRITT?
3. Welche WUENSCHE des Kandidaten werden erfuellt/nicht erfuellt?
4. Gibt es RED FLAGS (Firma, Branche, Rolle, Gehalt)?
5. Wuerdest du als sein Recruiter diesen Job EMPFEHLEN?

GEHALTSSCHAETZUNG:
- Beruecksichtige Standort (Schweiz > DE/AT)
- Waehrung: CHF fuer Schweiz, EUR fuer DE/AT
- Brutto Jahresgehalt

Antworte NUR als JSON (kein Markdown, keine Backticks):
{
  "match_score": 0-100,
  "reasoning": "2-3 Saetze warum dieser Score",
  "matching_skills": ["Skills die passen"],
  "missing_skills": ["Skills die fehlen"],
  "salary_estimate": { "min": 0, "max": 0, "realistic": 0, "currency": "CHF", "reasoning": "..." },
  "recommendation": "apply | maybe | skip",
  "cover_letter_focus": "Worauf das Anschreiben fokussieren sollte",
  "recruiter_verdict": "1-2 Saetze Recruiter-Einschaetzung im Klartext",
  "career_assessment": { "direction": "aufstieg | seitwaerts | rueckschritt", "explanation": "Warum" },
  "wish_fulfillment": { "fulfilled": ["Erfuellte Wuensche"], "unfulfilled": ["Nicht erfuellte"], "score": 0-100 },
  "red_flags": ["Bedenken als Liste"],
  "recruiter_note": "Persoenliche Notiz an den Kandidaten, wie ein echter Recruiter sprechen wuerde"
}`;
}

export async function assessJobAsRecruiter(
  job: JobRow,
  cv: StructuredCV,
  profile: CandidateProfile | null,
  wishes: CandidateWishRow[]
): Promise<RecruiterAssessment> {
  await scoringSemaphore.acquire();

  try {
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    const prompt = buildRecruiterPrompt(job, cv, profile, wishes);

    const result = await withRetry(async () => {
      const response = await client.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude API');

      let cleaned = textBlock.text.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      return JSON.parse(cleaned) as RecruiterAssessment;
    });

    // Normalize recommendation
    if (typeof result.recommendation === 'string') {
      result.recommendation = result.recommendation.trim().split(/\s/)[0] as RecruiterAssessment['recommendation'];
    }

    // Ensure career_assessment has valid direction
    if (result.career_assessment?.direction) {
      const validDirections = ['aufstieg', 'seitwaerts', 'rueckschritt'];
      if (!validDirections.includes(result.career_assessment.direction)) {
        result.career_assessment.direction = 'seitwaerts';
      }
    }

    const directionEmoji = {
      aufstieg: '📈',
      seitwaerts: '↔️',
      rueckschritt: '📉',
    }[result.career_assessment?.direction || 'seitwaerts'];

    logger.info(
      `Recruiter assessed "${job.title}" at ${job.company}: ${result.match_score}/100 (${result.recommendation}) ${directionEmoji} ~${result.salary_estimate?.currency || 'CHF'} ${result.salary_estimate?.realistic || 'k.A.'}`
    );

    return result;
  } finally {
    scoringSemaphore.release();
  }
}
