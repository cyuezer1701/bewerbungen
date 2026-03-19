import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';
import { Activity, FlaskConical, Menu } from 'lucide-react';

interface HealthData {
  status: string;
  testMode: boolean;
  uptime: string;
  memoryMB: number;
  jobCount: number;
}

interface HeaderProps {
  onMenuToggle: () => void;
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    apiGet<HealthData>('/health').then(setHealth).catch(() => setHealth(null));
    const interval = setInterval(() => {
      apiGet<HealthData>('/health').then(setHealth).catch(() => setHealth(null));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const isHealthy = health?.status === 'ok';

  return (
    <>
      {health?.testMode && (
        <div className="bg-warning text-navy px-4 py-1.5 text-xs md:text-sm font-semibold flex items-center gap-2">
          <FlaskConical size={14} />
          <span className="hidden sm:inline">TEST MODE AKTIV — E-Mails werden umgeleitet, keine echten Bewerbungen</span>
          <span className="sm:hidden">TEST MODE AKTIV</span>
        </div>
      )}
      <header className="h-12 bg-card border-b border-border flex items-center justify-between px-3 md:px-4">
        <div className="flex items-center gap-2">
          <button onClick={onMenuToggle} className="md:hidden p-1 text-text-muted hover:text-text">
            <Menu size={20} />
          </button>
          <Activity size={16} className="text-text-muted hidden md:block" />
          <span className="text-text-muted text-sm hidden md:block">System</span>
        </div>
        <div className="flex items-center gap-3">
          {health && (
            <span className="text-text-muted text-xs font-mono">
              <span className="hidden sm:inline">{health.uptime} | {health.memoryMB}MB | </span>
              {health.jobCount} Jobs
            </span>
          )}
          <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-accent' : 'bg-danger'}`} />
        </div>
      </header>
    </>
  );
}
