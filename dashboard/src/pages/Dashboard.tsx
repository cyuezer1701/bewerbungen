import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { Briefcase, Target, Send, Users, DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Stats {
  jobs_total: number;
  jobs_by_status: Record<string, number>;
  jobs_this_week: number;
  applications_total: number;
  weekly_stats: { applied: number; interview: number; rejected: number; offer: number };
  salary_overview: { avg: number; min: number; max: number; currency: string } | null;
}

interface FunnelStage {
  stage: string;
  count: number;
}

interface ActivityEntry {
  id: number;
  job_id: string;
  action: string;
  details: string | null;
  created_at: string;
}

interface HealthData {
  status: string;
  uptime: string;
  memoryMB: number;
  dbSizeMB: number;
  jobCount: number;
  applicationCount: number;
  lastScrape: string | null;
}

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

const FUNNEL_COLORS: Record<string, string> = {
  new: '#94a3b8', reviewed: '#64748b', applying: '#f59e0b',
  applied: '#3b82f6', interview: '#00ff87', offer: '#10b981', rejected: '#ef4444',
};

const ACTION_LABELS: Record<string, string> = {
  scraped: 'Job gescraped', matched: 'Job bewertet', generated: 'Anschreiben erstellt',
  edited: 'Anschreiben bearbeitet', sent: 'Bewerbung gesendet', status_changed: 'Status geaendert',
  follow_up: 'Follow-up', search_profile_added: 'Suchprofil erstellt',
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    apiGet<Stats>('/stats').then(setStats).catch(() => {});
    apiGet<FunnelStage[]>('/stats/funnel').then(setFunnel).catch(() => {});
    apiGet<{ data: ActivityEntry[] }>('/activity?limit=10').then((r) => setActivity(r.data)).catch(() => {});
    apiGet<HealthData>('/health').then(setHealth).catch(() => {});
  }, []);

  const kpis = [
    { label: 'Jobs Total', value: stats?.jobs_total ?? 0, icon: Briefcase, color: 'text-text' },
    { label: 'Matched', value: stats?.jobs_by_status?.['new'] ?? 0, icon: Target, color: 'text-accent' },
    { label: 'Beworben', value: stats?.applications_total ?? 0, icon: Send, color: 'text-blue-400' },
    { label: 'Interviews', value: stats?.weekly_stats?.interview ?? 0, icon: Users, color: 'text-warning' },
    { label: 'Ø Gehalt', value: stats?.salary_overview ? `${stats.salary_overview.currency} ${formatNum(stats.salary_overview.avg)}` : 'k.A.', icon: DollarSign, color: 'text-accent' },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1 md:mb-2">
              <kpi.icon size={16} className="text-text-muted" />
              <span className="text-text-muted text-xs">{kpi.label}</span>
            </div>
            <div className={`font-mono text-xl md:text-2xl font-bold ${kpi.color}`}>
              {typeof kpi.value === 'number' ? formatNum(kpi.value) : kpi.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Funnel Chart */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-text mb-4">Application Funnel</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={funnel} layout="vertical">
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis dataKey="stage" type="category" width={80} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e293b', color: '#e2e8f0' }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {funnel.map((entry) => (
                  <Cell key={entry.stage} fill={FUNNEL_COLORS[entry.stage] || '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* System Status */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-text mb-4">System Status</h2>
          {health ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Status</span>
                <span className={health.status === 'ok' ? 'text-accent' : 'text-danger'}>
                  {health.status === 'ok' ? '● Online' : '● Fehler'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Uptime</span>
                <span className="font-mono text-text">{health.uptime}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Memory</span>
                <span className="font-mono text-text">{health.memoryMB} MB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Datenbank</span>
                <span className="font-mono text-text">{health.dbSizeMB} MB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Jobs</span>
                <span className="font-mono text-text">{health.jobCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Bewerbungen</span>
                <span className="font-mono text-text">{health.applicationCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Letzter Scrape</span>
                <span className="font-mono text-text">{health.lastScrape || 'Noch nie'}</span>
              </div>
            </div>
          ) : (
            <p className="text-text-muted">Lade...</p>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-text mb-4">Letzte Aktivitaeten</h2>
        {activity.length === 0 ? (
          <p className="text-text-muted text-sm">Keine Aktivitaeten vorhanden</p>
        ) : (
          <div className="space-y-2">
            {activity.map((a) => {
              const time = new Date(a.created_at + 'Z').toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
              const date = new Date(a.created_at + 'Z').toLocaleDateString('de-CH');
              let detail = '';
              if (a.details) {
                try {
                  const d = JSON.parse(a.details);
                  if (d.title) detail = `${d.title} @ ${d.company}`;
                  if (d.match_score) detail += ` — ${d.match_score}%`;
                  if (d.from && d.to) detail = `${d.from} → ${d.to}`;
                } catch { detail = ''; }
              }
              return (
                <div key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm py-1">
                  <span className="font-mono text-text-muted text-xs shrink-0">{date} {time}</span>
                  <span className="text-text">{ACTION_LABELS[a.action] || a.action}</span>
                  {detail && <span className="text-text-muted truncate text-xs sm:text-sm">{detail}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
