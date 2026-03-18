import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';
import { Activity } from 'lucide-react';

interface HealthData {
  status: string;
  uptime: string;
  memoryMB: number;
  jobCount: number;
}

export default function Header() {
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
    <header className="h-12 bg-card border-b border-border flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <Activity size={16} className="text-text-muted" />
        <span className="text-text-muted text-sm">System</span>
      </div>
      <div className="flex items-center gap-3">
        {health && (
          <span className="text-text-muted text-xs font-mono">
            {health.uptime} | {health.memoryMB}MB | {health.jobCount} Jobs
          </span>
        )}
        <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-accent' : 'bg-danger'}`} />
      </div>
    </header>
  );
}
