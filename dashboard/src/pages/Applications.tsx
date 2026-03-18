import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPatch } from '../api/client';
import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface AppItem {
  id: string;
  job_id: string;
  job_title: string;
  job_company: string;
  version: number;
  status: string;
  sent_at: string | null;
  created_at: string;
}

const COLUMNS = [
  { id: 'draft', label: 'Draft', color: 'border-border' },
  { id: 'ready', label: 'Ready', color: 'border-accent/50' },
  { id: 'sent', label: 'Sent', color: 'border-blue-500/50' },
  { id: 'interview', label: 'Interview', color: 'border-warning/50' },
  { id: 'offer', label: 'Offer', color: 'border-green-500/50' },
  { id: 'rejected', label: 'Rejected', color: 'border-danger/50' },
];

// Map job statuses to kanban columns for applications that inherit job status
function mapToColumn(appStatus: string): string {
  if (COLUMNS.some(c => c.id === appStatus)) return appStatus;
  return 'draft';
}

function AppCard({ app, onClick }: { app: AppItem; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: app.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-navy border border-border rounded p-3 cursor-pointer hover:border-accent/30 transition"
    >
      <p className="text-sm font-medium text-text">{app.job_company}</p>
      <p className="text-xs text-text-muted">{app.job_title}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-text-muted">v{app.version}</span>
        <span className="text-xs text-text-muted">
          {new Date(app.created_at + 'Z').toLocaleDateString('de-CH')}
        </span>
      </div>
    </div>
  );
}

export default function Applications() {
  const navigate = useNavigate();
  const [apps, setApps] = useState<AppItem[]>([]);

  useEffect(() => {
    apiGet<{ data: AppItem[] }>('/applications?limit=200').then((res) => setApps(res.data)).catch(() => {});
  }, []);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const overId = String(over.id);
    // Check if dropped on a column
    const targetColumn = COLUMNS.find(c => c.id === overId);
    if (!targetColumn) return;

    const appId = String(active.id);
    const app = apps.find(a => a.id === appId);
    if (!app || mapToColumn(app.status) === targetColumn.id) return;

    // Optimistic update
    setApps(prev => prev.map(a => a.id === appId ? { ...a, status: targetColumn.id } : a));

    try {
      await apiPatch(`/applications/${appId}`, { status: targetColumn.id });
    } catch {
      // Revert on error
      setApps(prev => prev.map(a => a.id === appId ? { ...a, status: app.status } : a));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text">Bewerbungen ({apps.length})</h1>

      {/* Mini funnel */}
      <div className="flex gap-2">
        {COLUMNS.map((col) => {
          const count = apps.filter(a => mapToColumn(a.status) === col.id).length;
          return (
            <div key={col.id} className="flex items-center gap-1 text-xs text-text-muted">
              <span className={`w-2 h-2 rounded-full ${
                col.id === 'draft' ? 'bg-border' :
                col.id === 'ready' ? 'bg-accent' :
                col.id === 'sent' ? 'bg-blue-400' :
                col.id === 'interview' ? 'bg-warning' :
                col.id === 'offer' ? 'bg-green-400' :
                'bg-danger'
              }`} />
              {col.label}: {count}
            </div>
          );
        })}
      </div>

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-6 gap-3">
          {COLUMNS.map((col) => {
            const columnApps = apps.filter(a => mapToColumn(a.status) === col.id);
            return (
              <div key={col.id} className={`bg-card border-t-2 ${col.color} rounded-lg p-2 min-h-[300px]`}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs font-semibold text-text-muted">{col.label}</span>
                  <span className="text-xs text-text-muted">{columnApps.length}</span>
                </div>
                <div className="space-y-2" id={col.id}>
                  {columnApps.map((app) => (
                    <AppCard key={app.id} app={app} onClick={() => navigate(`/applications/${app.id}`)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}
