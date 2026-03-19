import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPatch, apiPost } from '../api/client';
import { ArrowLeft, RefreshCw, Download, Send, ExternalLink, Save } from 'lucide-react';

interface Application {
  id: string; job_id: string; cover_letter_text: string | null;
  cover_letter_pdf_path: string | null; full_package_pdf_path: string | null;
  version: number; status: string; sent_at: string | null;
  sent_via: string | null; sent_to: string | null;
  job_title?: string; job_company?: string;
}

interface Job {
  id: string; title: string; company: string; location: string | null;
  salary_estimate_realistic: number | null; salary_currency: string;
  application_method: string | null; application_url: string | null;
  application_email: string | null;
}

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

export default function ApplicationEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [app, setApp] = useState<Application | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiGet<Application>(`/applications/${id}`).then((a) => {
      setApp(a);
      setText(a.cover_letter_text || '');
      // Fetch job details
      const jobId = (a as unknown as { job_id: string }).job_id;
      if (jobId) apiGet<Job>(`/jobs/${jobId}`).then(setJob).catch(() => {});
    }).catch(() => navigate('/applications'));
  }, [id, navigate]);

  if (!app) return <div className="text-text-muted">Lade...</div>;

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await apiPatch<Application>(`/applications/${id}`, { cover_letter_text: text });
      setApp(updated);
    } finally { setSaving(false); }
  }

  async function handleRegenerate() {
    if (!feedback.trim()) return;
    setRegenerating(true);
    try {
      const updated = await apiPost<Application>(`/applications/${id}/regenerate`, { feedback });
      setApp(updated);
      setText(updated.cover_letter_text || '');
      setFeedback('');
      setShowFeedback(false);
    } finally { setRegenerating(false); }
  }

  async function handleSendEmail() {
    setSending(true);
    try {
      await apiPost(`/applications/${id}/send-email`);
      const updated = await apiGet<Application>(`/applications/${id}`);
      setApp(updated);
    } finally { setSending(false); }
  }

  async function handleMarkSent() {
    await apiPost(`/applications/${id}/mark-sent`);
    const updated = await apiGet<Application>(`/applications/${id}`);
    setApp(updated);
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/applications')} className="flex items-center gap-1 text-text-muted hover:text-text text-sm">
        <ArrowLeft size={14} /> Zurueck zu Bewerbungen
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Editor */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text">
                Anschreiben v{app.version}
                {app.sent_at && <span className="ml-2 text-accent text-xs">Gesendet</span>}
              </h2>
              <span className={`text-xs font-mono ${wordCount >= 250 && wordCount <= 350 ? 'text-accent' : 'text-warning'}`}>
                {wordCount} Woerter
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-[300px] md:h-[500px] bg-navy border border-border rounded p-3 md:p-4 text-sm text-text font-sans leading-relaxed resize-none focus:outline-none focus:border-accent"
            />
          </div>

          {/* Feedback input for Claude regeneration */}
          {showFeedback && (
            <div className="bg-card border border-accent/30 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-text mb-2">Claude Feedback</h3>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="z.B. Mehr Fokus auf Teamfuehrung, weniger technisch..."
                className="w-full h-24 bg-navy border border-border rounded p-3 text-sm text-text resize-none focus:outline-none focus:border-accent mb-2"
              />
              <div className="flex gap-2">
                <button onClick={handleRegenerate} disabled={regenerating || !feedback.trim()}
                  className="flex items-center gap-1 bg-accent text-navy px-3 py-1.5 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                  <RefreshCw size={14} className={regenerating ? 'animate-spin' : ''} />
                  {regenerating ? 'Generiere...' : 'Ueberarbeiten'}
                </button>
                <button onClick={() => setShowFeedback(false)}
                  className="px-3 py-1.5 text-text-muted text-sm hover:text-text">Abbrechen</button>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1 bg-accent text-navy px-4 py-2 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              <Save size={14} /> {saving ? 'Speichere...' : 'Speichern'}
            </button>
            <button onClick={() => setShowFeedback(true)}
              className="flex items-center gap-1 bg-card border border-accent text-accent px-4 py-2 rounded text-sm hover:bg-accent/10">
              <RefreshCw size={14} /> Mit Claude ueberarbeiten
            </button>
            {app.full_package_pdf_path && (
              <a href={`/api/applications/${app.id}/pdf?type=komplett`}
                className="flex items-center gap-1 bg-card border border-border text-text px-4 py-2 rounded text-sm hover:bg-navy">
                <Download size={14} /> PDF herunterladen
              </a>
            )}
          </div>
        </div>

        {/* Right: Job Info + Send Actions */}
        <div className="space-y-4">
          {job && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-text mb-2">{job.title}</h2>
              <p className="text-text-muted text-sm">{job.company} · {job.location || 'k.A.'}</p>
              {job.salary_estimate_realistic && (
                <p className="text-accent font-mono font-bold mt-2">
                  ~{job.salary_currency} {formatNum(job.salary_estimate_realistic)}
                </p>
              )}
            </div>
          )}

          {/* Send Actions */}
          <div className="bg-card border border-border rounded-lg p-5 space-y-2">
            <h2 className="text-xs font-semibold text-text-muted mb-2">VERSAND</h2>

            {job?.application_email && (job.application_method === 'email' || job.application_method === 'both') && (
              <button onClick={handleSendEmail} disabled={sending}
                className="w-full flex items-center justify-center gap-2 bg-blue-500/20 text-blue-400 py-2 rounded text-sm hover:bg-blue-500/30 disabled:opacity-50">
                <Send size={14} /> {sending ? 'Sende...' : `Per Mail an ${job.application_email}`}
              </button>
            )}

            {job?.application_url && (job.application_method === 'portal' || job.application_method === 'both') && (
              <>
                <a href={job.application_url} target="_blank" rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-accent/20 text-accent py-2 rounded text-sm hover:bg-accent/30">
                  <ExternalLink size={14} /> Portal oeffnen
                </a>
                <button onClick={handleMarkSent}
                  className="w-full flex items-center justify-center gap-2 bg-border text-text py-2 rounded text-sm hover:bg-border/80">
                  Als gesendet markieren
                </button>
              </>
            )}

            {app.sent_at && (
              <p className="text-xs text-accent text-center mt-2">
                Gesendet am {new Date(app.sent_at + 'Z').toLocaleDateString('de-CH')}
                {app.sent_via && ` via ${app.sent_via}`}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
