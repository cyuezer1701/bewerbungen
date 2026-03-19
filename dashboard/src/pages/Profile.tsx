import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { RefreshCw, Plus, X } from 'lucide-react';

interface ProfileData {
  exists: boolean;
  career_trajectory?: string;
  strengths?: string[];
  usps?: string[];
  experience_summary?: string;
  generated_at?: string;
  [key: string]: unknown;
}

interface SearchStrategy {
  keywords: string[];
  source: string;
  exclude: string[];
}

function tagColor(type: 'keyword' | 'source' | 'exclude'): string {
  if (type === 'keyword') return 'bg-accent/20 text-accent';
  if (type === 'source') return 'bg-blue-500/20 text-blue-400';
  return 'bg-danger/20 text-danger';
}

export default function Profile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [strategy, setStrategy] = useState<SearchStrategy | null>(null);
  const [generating, setGenerating] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newExclude, setNewExclude] = useState('');
  const [savingStrategy, setSavingStrategy] = useState(false);

  const loadProfile = useCallback(() => {
    apiGet<ProfileData>('/profile').then(setProfile).catch(() => setProfile({ exists: false }));
  }, []);

  const loadStrategy = useCallback(() => {
    apiGet<SearchStrategy>('/profile/search-strategy').then(setStrategy).catch(() => {});
  }, []);

  useEffect(() => { loadProfile(); loadStrategy(); }, [loadProfile, loadStrategy]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await apiPost('/profile/generate');
      loadProfile();
    } finally { setGenerating(false); }
  }

  async function saveStrategy(updated: SearchStrategy) {
    setSavingStrategy(true);
    try {
      await apiPatch('/profile/search-strategy', updated);
      setStrategy(updated);
    } finally { setSavingStrategy(false); }
  }

  function addKeyword() {
    if (!newKeyword.trim() || !strategy) return;
    const updated = { ...strategy, keywords: [...strategy.keywords, newKeyword.trim()] };
    saveStrategy(updated);
    setNewKeyword('');
  }

  function removeKeyword(kw: string) {
    if (!strategy) return;
    saveStrategy({ ...strategy, keywords: strategy.keywords.filter((k) => k !== kw) });
  }

  function addExclude() {
    if (!newExclude.trim() || !strategy) return;
    const updated = { ...strategy, exclude: [...strategy.exclude, newExclude.trim()] };
    saveStrategy(updated);
    setNewExclude('');
  }

  function removeExclude(kw: string) {
    if (!strategy) return;
    saveStrategy({ ...strategy, exclude: strategy.exclude.filter((k) => k !== kw) });
  }

  // Pick known display fields from profile
  const displayFields: { label: string; key: string }[] = [
    { label: 'Karriereverlauf', key: 'career_trajectory' },
    { label: 'Erfahrung', key: 'experience_summary' },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text">Profil</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Section A: Candidate Profile */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-text-muted">KANDIDATEN-PROFIL</h2>
            <button onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-1 bg-accent text-navy px-3 py-1.5 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
              {generating ? 'Generiere...' : profile?.exists ? 'Neu generieren' : 'Profil generieren'}
            </button>
          </div>

          {profile?.exists ? (
            <>
              {displayFields.map(({ label, key }) => {
                const val = profile[key];
                if (!val) return null;
                return (
                  <div key={key}>
                    <p className="text-xs text-text-muted mb-1">{label}</p>
                    <p className="text-sm text-text">{String(val)}</p>
                  </div>
                );
              })}

              {profile.strengths?.length ? (
                <div>
                  <p className="text-xs text-text-muted mb-1">Staerken</p>
                  <div className="flex flex-wrap gap-1">
                    {profile.strengths.map((s) => (
                      <span key={s} className="text-xs px-2 py-0.5 bg-accent/20 text-accent rounded">{s}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {profile.usps?.length ? (
                <div>
                  <p className="text-xs text-text-muted mb-1">USPs</p>
                  <div className="flex flex-wrap gap-1">
                    {profile.usps.map((u) => (
                      <span key={u} className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">{u}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {profile.generated_at && (
                <p className="text-xs text-text-muted border-t border-border pt-2">
                  Generiert am {new Date(profile.generated_at).toLocaleDateString('de-CH')}
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-text-muted text-sm">
              Noch kein Profil generiert. Klicke oben auf "Profil generieren".
            </div>
          )}
        </div>

        {/* Section B: Search Strategy */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="text-xs font-semibold text-text-muted">SUCHSTRATEGIE</h2>

          {strategy ? (
            <>
              {/* Source info */}
              {strategy.source && (
                <p className="text-xs text-text-muted bg-navy border border-border rounded px-3 py-2">{strategy.source}</p>
              )}

              {/* Keywords */}
              <div>
                <p className="text-xs text-text-muted mb-2">Keywords</p>
                <div className="flex flex-wrap gap-1">
                  {strategy.keywords.map((kw) => (
                    <span key={kw} className={`text-xs px-2 py-0.5 rounded flex items-center gap-1 ${tagColor('keyword')}`}>
                      {kw}
                      <button onClick={() => removeKeyword(kw)} className="hover:text-text"><X size={10} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder="Keyword hinzufuegen"
                    className="flex-1 bg-navy border border-border rounded px-2 py-1 text-sm text-text focus:outline-none focus:border-accent"
                    onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                  />
                  <button onClick={addKeyword} disabled={!newKeyword.trim() || savingStrategy}
                    className="text-accent hover:text-accent/80 disabled:opacity-50"><Plus size={16} /></button>
                </div>
              </div>

              {/* Exclude Keywords (red) */}
              <div>
                <p className="text-xs text-text-muted mb-2">Ausschluss Keywords</p>
                <div className="flex flex-wrap gap-1">
                  {strategy.exclude.map((kw) => (
                    <span key={kw} className={`text-xs px-2 py-0.5 rounded flex items-center gap-1 ${tagColor('exclude')}`}>
                      {kw}
                      <button onClick={() => removeExclude(kw)} className="hover:text-text"><X size={10} /></button>
                    </span>
                  ))}
                  {strategy.exclude.length === 0 && <span className="text-xs text-text-muted">Keine</span>}
                </div>
                <div className="flex gap-2 mt-2">
                  <input value={newExclude} onChange={(e) => setNewExclude(e.target.value)}
                    placeholder="Ausschluss Keyword"
                    className="flex-1 bg-navy border border-border rounded px-2 py-1 text-sm text-text focus:outline-none focus:border-accent"
                    onKeyDown={(e) => e.key === 'Enter' && addExclude()}
                  />
                  <button onClick={addExclude} disabled={!newExclude.trim() || savingStrategy}
                    className="text-danger hover:text-danger/80 disabled:opacity-50"><Plus size={16} /></button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted text-sm">Lade Suchstrategie...</div>
          )}
        </div>
      </div>
    </div>
  );
}
