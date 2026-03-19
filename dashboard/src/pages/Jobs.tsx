import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { Search, RefreshCw, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface Job {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string | null;
  salary_estimate_min: number | null;
  salary_estimate_max: number | null;
  salary_estimate_realistic: number | null;
  salary_currency: string;
  application_method: string | null;
  match_score: number | null;
  status: string;
  created_at: string;
}

interface JobsResponse {
  data: Job[];
  total: number;
  page: number;
  limit: number;
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

const STATUSES = ['all', 'new', 'reviewed', 'applying', 'applied', 'interview', 'rejected', 'offer'];
const SOURCES = ['linkedin', 'indeed', 'jobsch'];

export default function Jobs() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('match_score');
  const [order, setOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [scraping, setScraping] = useState(false);
  const limit = 20;

  const fetchJobs = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page), limit: String(limit), sort, order,
    });
    if (status !== 'all') params.set('status', status);
    if (search) params.set('search', search);
    const res = await apiGet<JobsResponse>(`/jobs?${params}`);
    setJobs(res.data);
    setTotal(res.total);
  }, [page, status, search, sort, order]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  async function handleScrape() {
    setScraping(true);
    try {
      await apiPost('/jobs/scrape-now');
      await fetchJobs();
    } finally {
      setScraping(false);
    }
  }

  async function handleSkip(id: string) {
    await apiPatch(`/jobs/${id}`, { status: 'reviewed' });
    await fetchJobs();
  }

  async function handleApply(id: string) {
    await apiPost('/applications', { job_id: id });
    await fetchJobs();
  }

  function toggleSort(col: string) {
    if (sort === col) {
      setOrder(order === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSort(col);
      setOrder('DESC');
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Jobs ({total})</h1>
        <button
          onClick={handleScrape}
          disabled={scraping}
          className="flex items-center gap-2 bg-accent text-navy px-3 md:px-4 py-2 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw size={14} className={scraping ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{scraping ? 'Scraping...' : 'Jetzt scrapen'}</span>
          <span className="sm:hidden">{scraping ? '...' : 'Scrape'}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 bg-card border border-border rounded-lg p-2 md:p-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="bg-navy border border-border rounded px-2 py-1.5 text-sm text-text"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'Alle Status' : s}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 bg-navy border border-border rounded px-2 py-1.5 flex-1 min-w-[120px] md:flex-none">
          <Search size={14} className="text-text-muted shrink-0" />
          <input
            type="text"
            placeholder="Suche..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="bg-transparent text-sm text-text outline-none w-full md:w-48"
          />
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs text-text-muted">
          {SOURCES.map((s) => (
            <span key={s} className="px-2 py-1 bg-navy border border-border rounded">{s}</span>
          ))}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-left">
              {[
                { key: 'match_score', label: 'Score', w: 'w-16' },
                { key: 'title', label: 'Titel', w: '' },
                { key: 'company', label: 'Firma', w: '' },
                { key: '', label: 'Gehalt', w: 'w-48' },
                { key: '', label: 'Methode', w: 'w-20' },
                { key: '', label: 'Quelle', w: 'w-20' },
                { key: '', label: 'Status', w: 'w-24' },
                { key: 'created_at', label: 'Datum', w: 'w-24' },
                { key: '', label: '', w: 'w-36' },
              ].map((col) => (
                <th
                  key={col.label || 'actions'}
                  className={`px-3 py-2 font-medium ${col.w} ${col.key ? 'cursor-pointer hover:text-text' : ''}`}
                  onClick={() => col.key && toggleSort(col.key)}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.key && sort === col.key && <ArrowUpDown size={12} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="border-b border-border/50 hover:bg-navy/50 cursor-pointer"
                onClick={() => navigate(`/jobs/${job.id}`)}
              >
                <td className={`px-3 py-2 font-mono font-bold ${scoreColor(job.match_score)}`}>
                  {job.match_score ?? '—'}
                </td>
                <td className="px-3 py-2 text-text font-medium">{job.title}</td>
                <td className="px-3 py-2 text-text-muted">{job.company}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {job.salary_estimate_realistic ? (
                    <span className="text-accent">~{job.salary_currency} {formatNum(job.salary_estimate_realistic)}</span>
                  ) : job.salary_estimate_min ? (
                    <span className="text-text-muted">{job.salary_currency} {formatNum(job.salary_estimate_min)}–{formatNum(job.salary_estimate_max!)}</span>
                  ) : (
                    <span className="text-text-muted">k.A.</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    job.application_method === 'email' ? 'bg-blue-500/20 text-blue-400' :
                    job.application_method === 'both' ? 'bg-purple-500/20 text-purple-400' :
                    'bg-accent/20 text-accent'
                  }`}>
                    {job.application_method === 'email' ? '📧' : job.application_method === 'both' ? '📧📝' : '📝'}
                  </span>
                </td>
                <td className="px-3 py-2 text-text-muted text-xs">{job.source}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    job.status === 'new' ? 'bg-accent/20 text-accent' :
                    job.status === 'applied' ? 'bg-blue-500/20 text-blue-400' :
                    job.status === 'interview' ? 'bg-warning/20 text-warning' :
                    job.status === 'rejected' ? 'bg-danger/20 text-danger' :
                    job.status === 'offer' ? 'bg-green-500/20 text-green-400' :
                    'bg-border text-text-muted'
                  }`}>{job.status}</span>
                </td>
                <td className="px-3 py-2 text-text-muted text-xs">
                  {new Date(job.created_at + 'Z').toLocaleDateString('de-CH')}
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleApply(job.id)}
                      className="text-xs px-2 py-1 bg-accent/20 text-accent rounded hover:bg-accent/30"
                    >Bewerben</button>
                    <button
                      onClick={() => handleSkip(job.id)}
                      className="text-xs px-2 py-1 bg-border text-text-muted rounded hover:bg-border/80"
                    >Skip</button>
                  </div>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-text-muted">Keine Jobs gefunden</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {jobs.map((job) => (
          <div
            key={job.id}
            onClick={() => navigate(`/jobs/${job.id}`)}
            className="bg-card border border-border rounded-lg p-3 active:bg-navy/50 cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text truncate">{job.title}</p>
                <p className="text-xs text-text-muted truncate">{job.company} · {job.location || 'k.A.'}</p>
              </div>
              <span className={`font-mono text-lg font-bold shrink-0 ${scoreColor(job.match_score)}`}>
                {job.match_score ?? '—'}
              </span>
            </div>
            <div className="flex items-center flex-wrap gap-2 mb-2">
              <span className="text-xs font-mono text-accent">
                {job.salary_estimate_realistic
                  ? `~${job.salary_currency} ${formatNum(job.salary_estimate_realistic)}`
                  : job.salary_estimate_min
                    ? `${job.salary_currency} ${formatNum(job.salary_estimate_min)}–${formatNum(job.salary_estimate_max!)}`
                    : 'k.A.'}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                job.application_method === 'email' ? 'bg-blue-500/20 text-blue-400' :
                job.application_method === 'both' ? 'bg-purple-500/20 text-purple-400' :
                'bg-accent/20 text-accent'
              }`}>
                {job.application_method === 'email' ? '📧 Mail' : job.application_method === 'both' ? '📧📝' : '📝 Portal'}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                job.status === 'new' ? 'bg-accent/20 text-accent' :
                job.status === 'applied' ? 'bg-blue-500/20 text-blue-400' :
                job.status === 'interview' ? 'bg-warning/20 text-warning' :
                job.status === 'rejected' ? 'bg-danger/20 text-danger' :
                job.status === 'offer' ? 'bg-green-500/20 text-green-400' :
                'bg-border text-text-muted'
              }`}>{job.status}</span>
            </div>
            <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
              <span className="text-xs text-text-muted">{job.source} · {new Date(job.created_at + 'Z').toLocaleDateString('de-CH')}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => handleApply(job.id)}
                  className="text-xs px-2.5 py-1.5 bg-accent/20 text-accent rounded hover:bg-accent/30"
                >Bewerben</button>
                <button
                  onClick={() => handleSkip(job.id)}
                  className="text-xs px-2.5 py-1.5 bg-border text-text-muted rounded hover:bg-border/80"
                >Skip</button>
              </div>
            </div>
          </div>
        ))}
        {jobs.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-8 text-center text-text-muted">
            Keine Jobs gefunden
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="p-1 text-text-muted hover:text-text disabled:opacity-30"
          ><ChevronLeft size={18} /></button>
          <span className="text-sm text-text-muted">Seite {page} von {totalPages}</span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="p-1 text-text-muted hover:text-text disabled:opacity-30"
          ><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  );
}
