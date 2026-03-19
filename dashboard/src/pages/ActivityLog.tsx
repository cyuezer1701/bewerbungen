import { useEffect, useState, useCallback } from 'react';
import { apiGet } from '../api/client';
import { ChevronLeft, ChevronRight, Activity, Briefcase, FileText, Send, RefreshCw, Search as SearchIcon } from 'lucide-react';

interface LogEntry {
  id: number; job_id: string | null; application_id: string | null;
  action: string; details: string | null; created_at: string;
}

const ACTION_ICONS: Record<string, typeof Activity> = {
  scraped: Briefcase, matched: SearchIcon, generated: FileText,
  edited: RefreshCw, sent: Send, status_changed: Activity, follow_up: Activity,
};

const ACTION_LABELS: Record<string, string> = {
  scraped: 'Job gescraped', matched: 'Job bewertet', generated: 'Anschreiben erstellt',
  edited: 'Anschreiben bearbeitet', sent: 'Bewerbung gesendet', status_changed: 'Status geaendert',
  follow_up: 'Follow-up', search_profile_added: 'Suchprofil erstellt',
  search_profile_removed: 'Suchprofil entfernt',
};

const ACTIONS = ['', 'scraped', 'matched', 'generated', 'edited', 'sent', 'status_changed', 'follow_up'];

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const limit = 30;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (actionFilter) params.set('action', actionFilter);
    const res = await apiGet<{ data: LogEntry[]; total: number }>(`/activity?${params}`);
    setEntries(res.data);
    setTotal(res.total);
  }, [page, actionFilter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-text">Aktivitaeten ({total})</h1>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="bg-navy border border-border rounded px-3 py-1.5 text-sm text-text">
          <option value="">Alle Aktionen</option>
          {ACTIONS.filter(Boolean).map((a) => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}
        </select>
      </div>

      <div className="bg-card border border-border rounded-lg divide-y divide-border/50">
        {entries.map((entry) => {
          const Icon = ACTION_ICONS[entry.action] || Activity;
          const time = new Date(entry.created_at + 'Z');
          let detail = '';
          if (entry.details) {
            try {
              const d = JSON.parse(entry.details);
              if (d.title && d.company) detail = `${d.title} @ ${d.company}`;
              else if (d.match_score) detail = `Score: ${d.match_score}%`;
              else if (d.from && d.to) detail = `${d.from} → ${d.to}`;
              else if (d.version) detail = `Version ${d.version}`;
              else if (d.sent_to) detail = `an ${d.sent_to}`;
              else if (d.keywords) detail = d.keywords;
            } catch {}
          }

          return (
            <div key={entry.id} className="flex items-start sm:items-center gap-3 px-3 md:px-4 py-3">
              <Icon size={16} className="text-text-muted shrink-0 mt-0.5 sm:mt-0" />
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                  <span className="text-sm text-text">{ACTION_LABELS[entry.action] || entry.action}</span>
                  {detail && <span className="text-xs sm:text-sm text-text-muted truncate">{detail}</span>}
                </div>
                <span className="text-xs font-mono text-text-muted sm:hidden">
                  {time.toLocaleDateString('de-CH')} {time.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <span className="text-xs font-mono text-text-muted shrink-0 hidden sm:block">
                {time.toLocaleDateString('de-CH')} {time.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
        {entries.length === 0 && (
          <div className="px-4 py-8 text-center text-text-muted">Keine Aktivitaeten vorhanden</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
            className="p-1 text-text-muted hover:text-text disabled:opacity-30"><ChevronLeft size={18} /></button>
          <span className="text-sm text-text-muted">Seite {page} von {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
            className="p-1 text-text-muted hover:text-text disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  );
}
