import { useEffect, useState, useRef } from 'react';
import { apiGet, apiPost, apiDelete } from '../api/client';
import { Upload, Trash2, RefreshCw, FileText, ChevronDown, ChevronRight } from 'lucide-react';

interface Doc {
  name: string; type: string; size: number; path: string;
}

interface StructuredCV {
  name: string; current_role: string; years_experience: number;
  skills_technical: string[]; skills_soft: string[]; certifications: string[];
  languages: Array<{ language: string; level: string }>;
  education: Array<{ degree: string; institution: string; year: string }>;
  work_history: Array<{ role: string; company: string; duration: string; highlights: string[] }>;
  key_achievements: string[]; preferred_roles: string[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [cv, setCv] = useState<StructuredCV | null>(null);
  const [cvOpen, setCvOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const zeugRef = useRef<HTMLInputElement>(null);

  async function load() {
    apiGet<Doc[]>('/documents').then(setDocs).catch(() => {});
    apiGet<StructuredCV>('/documents/cv-structured').then(setCv).catch(() => setCv(null));
  }
  useEffect(() => { load(); }, []);

  const cvDoc = docs.find((d) => d.type === 'cv');
  const zeugnisse = docs.filter((d) => d.type === 'zeugnis');

  async function uploadFile(file: File, type: string) {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    await fetch('/api/documents/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('api_token')}` },
      body: form,
    });
    load();
  }

  async function handleReparse() {
    setParsing(true);
    try {
      const parsed = await apiPost<StructuredCV>('/documents/reparse-cv');
      setCv(parsed);
    } finally { setParsing(false); }
  }

  async function handleDelete(name: string) {
    await apiDelete(`/documents/${name}`);
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-text">Dokumente</h1>

      {/* CV Section */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-text mb-4">Lebenslauf</h2>
        {cvDoc ? (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <FileText size={20} className="text-accent" />
              <div>
                <p className="text-sm text-text">{cvDoc.name}</p>
                <p className="text-xs text-text-muted">{formatSize(cvDoc.size)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => fileRef.current?.click()}
                className="text-xs px-3 py-1.5 bg-border text-text rounded hover:bg-border/80">Austauschen</button>
              <button onClick={handleReparse} disabled={parsing}
                className="text-xs px-3 py-1.5 bg-accent/20 text-accent rounded hover:bg-accent/30 disabled:opacity-50 flex items-center gap-1">
                <RefreshCw size={12} className={parsing ? 'animate-spin' : ''} />
                {parsing ? 'Parse...' : 'Neu parsen'}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center mb-4 cursor-pointer hover:border-accent/50"
            onClick={() => fileRef.current?.click()}>
            <Upload size={24} className="mx-auto text-text-muted mb-2" />
            <p className="text-sm text-text-muted">CV hier hochladen (PDF)</p>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".pdf" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) uploadFile(e.target.files[0], 'cv'); }} />

        {/* Parsed CV Accordion */}
        {cv && (
          <div className="border-t border-border pt-3">
            <button onClick={() => setCvOpen(!cvOpen)}
              className="flex items-center gap-2 text-sm text-text-muted hover:text-text w-full">
              {cvOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Geparster Lebenslauf
            </button>
            {cvOpen && (
              <div className="mt-3 space-y-3 text-sm">
                <div><span className="text-text-muted">Name:</span> <span className="text-text">{cv.name}</span></div>
                <div><span className="text-text-muted">Rolle:</span> <span className="text-text">{cv.current_role}</span></div>
                <div><span className="text-text-muted">Erfahrung:</span> <span className="text-text">{cv.years_experience} Jahre</span></div>
                <div>
                  <span className="text-text-muted">Technische Skills:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {cv.skills_technical.map((s) => (
                      <span key={s} className="text-xs px-2 py-0.5 bg-accent/20 text-accent rounded">{s}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-text-muted">Zertifikate:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {cv.certifications.map((c) => (
                      <span key={c} className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">{c}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-text-muted">Berufserfahrung:</span>
                  {cv.work_history.map((w, i) => (
                    <div key={i} className="mt-1 ml-2 border-l-2 border-border pl-3">
                      <p className="text-text font-medium">{w.role} @ {w.company}</p>
                      <p className="text-text-muted text-xs">{w.duration}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zeugnisse Section */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-text mb-4">Zeugnisse & Nachweise</h2>
        {zeugnisse.length > 0 && (
          <div className="space-y-2 mb-4">
            {zeugnisse.map((z) => (
              <div key={z.name} className="flex items-center justify-between bg-navy rounded px-3 py-2">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-text-muted" />
                  <span className="text-sm text-text">{z.name}</span>
                  <span className="text-xs text-text-muted">{formatSize(z.size)}</span>
                </div>
                <button onClick={() => handleDelete(z.name)} className="text-text-muted hover:text-danger">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-accent/50"
          onClick={() => zeugRef.current?.click()}>
          <Upload size={20} className="mx-auto text-text-muted mb-1" />
          <p className="text-sm text-text-muted">Zeugnisse hier ablegen (PDF)</p>
        </div>
        <input ref={zeugRef} type="file" accept=".pdf" multiple className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              Array.from(e.target.files).forEach((f) => uploadFile(f, 'zeugnis'));
            }
          }} />
      </div>
    </div>
  );
}
