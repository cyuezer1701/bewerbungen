import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { ArrowLeft, ExternalLink, RefreshCw, Send, FileText } from 'lucide-react';

interface Job {
  id: string; title: string; company: string; location: string | null;
  description: string | null; source: string; source_url: string | null;
  salary_range: string | null; salary_estimate_min: number | null;
  salary_estimate_max: number | null; salary_estimate_realistic: number | null;
  salary_currency: string; salary_reasoning: string | null;
  application_method: string | null; application_url: string | null;
  application_email: string | null; match_score: number | null;
  match_reasoning: string | null; status: string; created_at: string;
}

interface Application {
  id: string; cover_letter_text: string | null; version: number;
  status: string; cover_letter_pdf_path: string | null;
  full_package_pdf_path: string | null; sent_at: string | null;
}

interface MatchDetails {
  matching_skills?: string[]; missing_skills?: string[];
  cover_letter_focus?: string;
}

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-text-muted';
  if (score >= 80) return 'text-accent';
  if (score >= 50) return 'text-warning';
  return 'text-danger';
}

const STATUSES = ['new', 'reviewed', 'applying', 'applied', 'interview', 'rejected', 'offer'];

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [app, setApp] = useState<Application | null>(null);
  const [matchDetails, setMatchDetails] = useState<MatchDetails>({});
  const [rematching, setRematching] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiGet<Job>(`/jobs/${id}`).then(setJob).catch(() => navigate('/jobs'));
    apiGet<{ data: Application[] }>(`/applications?status=&page=1&limit=100`).then((res) => {
      const found = res.data.find((a: Application & { job_id?: string }) =>
        (a as unknown as { job_id: string }).job_id === id
      );
      if (found) setApp(found);
    }).catch(() => {});
    // Get match details from activity log
    apiGet<{ data: Array<{ details: string | null }> }>(`/activity?job_id=${id}&action=matched&limit=1`).then((res) => {
      if (res.data[0]?.details) {
        try { setMatchDetails(JSON.parse(res.data[0].details)); } catch {}
      }
    }).catch(() => {});
  }, [id, navigate]);

  if (!job) return <div className="text-text-muted">Lade...</div>;

  async function handleRematch() {
    setRematching(true);
    try {
      await apiPost(`/jobs/${id}/rematch`);
      const updated = await apiGet<Job>(`/jobs/${id}`);
      setJob(updated);
    } finally { setRematching(false); }
  }

  async function handleApply() {
    setApplying(true);
    try {
      const newApp = await apiPost<Application>('/applications', { job_id: id });
      setApp(newApp);
    } finally { setApplying(false); }
  }

  async function handleStatusChange(newStatus: string) {
    await apiPatch(`/jobs/${id}`, { status: newStatus });
    setJob({ ...job!, status: newStatus });
  }

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/jobs')} className="flex items-center gap-1 text-text-muted hover:text-text text-sm">
        <ArrowLeft size={14} /> Zurueck zu Jobs
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Description */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h1 className="text-xl font-semibold text-text">{job.title}</h1>
                <p className="text-text-muted">{job.company} · {job.location || 'k.A.'}</p>
              </div>
              <div className={`font-mono text-3xl font-bold ${scoreColor(job.match_score)}`}>
                {job.match_score ?? '—'}%
              </div>
            </div>
            <div className="text-sm text-text leading-relaxed whitespace-pre-wrap">
              {job.description || 'Keine Beschreibung verfuegbar'}
            </div>
            {job.source_url && (
              <a href={job.source_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent text-sm mt-4 hover:underline">
                <ExternalLink size={14} /> Zum Inserat
              </a>
            )}
          </div>

          {/* Application Preview */}
          {app && (
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-text">Anschreiben (v{app.version})</h2>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/applications/${app.id}`)}
                    className="text-xs px-2 py-1 bg-accent/20 text-accent rounded hover:bg-accent/30">
                    Bearbeiten
                  </button>
                  {app.cover_letter_pdf_path && (
                    <a href={`/api/applications/${app.id}/pdf?type=komplett`}
                      className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30">
                      PDF Download
                    </a>
                  )}
                </div>
              </div>
              <p className="text-sm text-text-muted whitespace-pre-wrap line-clamp-6">
                {app.cover_letter_text || 'Kein Text verfuegbar'}
              </p>
              {app.sent_at && (
                <p className="text-xs text-accent mt-2">Gesendet am {new Date(app.sent_at + 'Z').toLocaleDateString('de-CH')}</p>
              )}
            </div>
          )}
        </div>

        {/* Right: Salary, Match, Actions */}
        <div className="space-y-4">
          {/* Salary Box */}
          <div className="bg-card border border-accent/30 rounded-lg p-5">
            <h2 className="text-xs font-semibold text-text-muted mb-3">💰 GEHALT</h2>
            {job.salary_estimate_realistic ? (
              <>
                <div className="text-2xl font-mono font-bold text-accent mb-1">
                  ~{job.salary_currency} {formatNum(job.salary_estimate_realistic)}
                </div>
                {job.salary_estimate_min && (
                  <p className="text-sm text-text-muted font-mono">
                    {job.salary_currency} {formatNum(job.salary_estimate_min)} – {formatNum(job.salary_estimate_max!)}
                  </p>
                )}
                {job.salary_range && <p className="text-xs text-text-muted mt-1">Inserat: {job.salary_range}</p>}
                {job.salary_reasoning && (
                  <p className="text-xs text-text-muted mt-2 border-t border-border pt-2">{job.salary_reasoning}</p>
                )}
              </>
            ) : (
              <p className="text-text-muted">Keine Schaetzung verfuegbar</p>
            )}
          </div>

          {/* Match Analysis */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-xs font-semibold text-text-muted mb-3">MATCH ANALYSE</h2>
            {job.match_reasoning && <p className="text-sm text-text mb-3">{job.match_reasoning}</p>}
            {matchDetails.matching_skills?.length ? (
              <div className="mb-2">
                <p className="text-xs text-text-muted mb-1">Passende Skills</p>
                <div className="flex flex-wrap gap-1">
                  {matchDetails.matching_skills.map((s) => (
                    <span key={s} className="text-xs px-2 py-0.5 bg-accent/20 text-accent rounded">{s}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {matchDetails.missing_skills?.length ? (
              <div>
                <p className="text-xs text-text-muted mb-1">Fehlende Skills</p>
                <div className="flex flex-wrap gap-1">
                  {matchDetails.missing_skills.map((s) => (
                    <span key={s} className="text-xs px-2 py-0.5 bg-danger/20 text-danger rounded">{s}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Application Method */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-xs font-semibold text-text-muted mb-3">BEWERBUNGSWEG</h2>
            {(job.application_method === 'portal' || job.application_method === 'both') && job.application_url && (
              <a href={job.application_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 bg-accent/20 text-accent px-3 py-2 rounded text-sm mb-2 hover:bg-accent/30">
                <ExternalLink size={14} /> 📝 Zum Portal
              </a>
            )}
            {(job.application_method === 'email' || job.application_method === 'both') && job.application_email && (
              <div className="flex items-center gap-2 bg-blue-500/20 text-blue-400 px-3 py-2 rounded text-sm">
                <Send size={14} /> 📧 {job.application_email}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="bg-card border border-border rounded-lg p-5 space-y-2">
            {!app && (
              <button onClick={handleApply} disabled={applying}
                className="w-full flex items-center justify-center gap-2 bg-accent text-navy py-2 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                <FileText size={14} /> {applying ? 'Generiere...' : 'Bewerbung erstellen'}
              </button>
            )}
            <button onClick={handleRematch} disabled={rematching}
              className="w-full flex items-center justify-center gap-2 bg-border text-text py-2 rounded text-sm hover:bg-border/80 disabled:opacity-50">
              <RefreshCw size={14} className={rematching ? 'animate-spin' : ''} />
              {rematching ? 'Bewerte...' : 'Neu bewerten'}
            </button>
            <select value={job.status} onChange={(e) => handleStatusChange(e.target.value)}
              className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
