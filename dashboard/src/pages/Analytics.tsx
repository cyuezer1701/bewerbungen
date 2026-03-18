import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface FunnelStage { stage: string; count: number; }
interface TimelineEntry { week: string; action: string; count: number; }
interface SalaryAnalysis {
  overall: Array<{ avg: number | null; min: number | null; max: number | null; currency: string; count: number }>;
  by_source: Array<{ source: string; avg_salary: number | null; count: number }>;
}
interface Stats {
  jobs_total: number;
  jobs_by_status: Record<string, number>;
  applications_total: number;
  weekly_stats: { applied: number; interview: number; rejected: number; offer: number };
}

const COLORS = ['#00ff87', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];
const FUNNEL_COLORS: Record<string, string> = {
  new: '#94a3b8', reviewed: '#64748b', applying: '#f59e0b', applied: '#3b82f6',
  interview: '#00ff87', offer: '#10b981', rejected: '#ef4444',
};

function formatNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

export default function Analytics() {
  const [, setStats] = useState<Stats | null>(null);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [salary, setSalary] = useState<SalaryAnalysis | null>(null);

  useEffect(() => {
    apiGet<Stats>('/stats').then(setStats).catch(() => {});
    apiGet<FunnelStage[]>('/stats/funnel').then(setFunnel).catch(() => {});
    apiGet<TimelineEntry[]>('/stats/timeline').then(setTimeline).catch(() => {});
    apiGet<SalaryAnalysis>('/stats/salary-analysis').then(setSalary).catch(() => {});
  }, []);

  // Aggregate timeline by week
  const weeklyData = timeline.reduce<Record<string, Record<string, number>>>((acc, t) => {
    if (!acc[t.week]) acc[t.week] = {};
    acc[t.week][t.action] = (acc[t.week][t.action] || 0) + t.count;
    return acc;
  }, {});
  const chartTimeline = Object.entries(weeklyData).map(([week, actions]) => ({ week, ...actions }));

  // Source distribution from salary analysis
  const sourceData = salary?.by_source.map((s) => ({ name: s.source, value: s.count })) || [];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-text">Analytics</h1>

      <div className="grid grid-cols-2 gap-4">
        {/* Funnel */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-text mb-4">Application Funnel</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={funnel} layout="vertical">
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis dataKey="stage" type="category" width={80} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e293b', color: '#e2e8f0' }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {funnel.map((e) => <Cell key={e.stage} fill={FUNNEL_COLORS[e.stage] || '#94a3b8'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Source Distribution */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-text mb-4">Jobs nach Quelle</h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={sourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e293b', color: '#e2e8f0' }} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Weekly Activity */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-text mb-4">Woechentliche Aktivitaet</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartTimeline}>
              <XAxis dataKey="week" tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e293b', color: '#e2e8f0' }} />
              <Line type="monotone" dataKey="scraped" stroke="#00ff87" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="matched" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="generated" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="sent" stroke="#a855f7" strokeWidth={2} dot={false} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Salary Overview */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-text mb-4">Gehalt Uebersicht</h2>
          {salary?.overall.map((s, i) => (
            <div key={i} className="mb-4">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-2xl font-mono font-bold text-accent">
                  {s.currency} {s.avg ? formatNum(Math.round(s.avg)) : 'k.A.'}
                </span>
                <span className="text-xs text-text-muted">Durchschnitt ({s.count} Jobs)</span>
              </div>
              {s.min && s.max && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-text-muted">{s.currency} {formatNum(s.min)}</span>
                  <div className="flex-1 h-2 bg-navy rounded-full overflow-hidden">
                    <div className="h-full bg-accent/50 rounded-full" style={{ width: '100%' }} />
                  </div>
                  <span className="text-xs font-mono text-text-muted">{s.currency} {formatNum(s.max)}</span>
                </div>
              )}
            </div>
          ))}
          {(!salary || salary.overall.length === 0) && (
            <p className="text-text-muted text-sm">Keine Gehaltsdaten verfuegbar</p>
          )}
          {salary?.by_source && salary.by_source.length > 0 && (
            <div className="border-t border-border pt-3 mt-3">
              <p className="text-xs text-text-muted mb-2">Nach Quelle</p>
              {salary.by_source.map((s) => (
                <div key={s.source} className="flex justify-between text-sm mb-1">
                  <span className="text-text-muted">{s.source}</span>
                  <span className="font-mono text-text">{s.avg_salary ? formatNum(Math.round(s.avg_salary)) : 'k.A.'} ({s.count})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
