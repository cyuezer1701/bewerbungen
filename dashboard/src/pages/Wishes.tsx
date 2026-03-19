import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';

interface Wish {
  id: string;
  wish: string;
  category: string;
  priority: string;
  is_active: boolean;
}

const CATEGORIES = ['gehalt', 'remote', 'branche', 'kultur', 'general'];
const PRIORITIES = ['low', 'medium', 'high'];

function priorityColor(p: string): string {
  if (p === 'high') return 'bg-danger/20 text-danger';
  if (p === 'medium') return 'bg-warning/20 text-warning';
  return 'bg-accent/20 text-accent';
}

function categoryLabel(c: string): string {
  const map: Record<string, string> = {
    gehalt: 'Gehalt', remote: 'Remote', branche: 'Branche',
    kultur: 'Kultur', general: 'Allgemein',
  };
  return map[c] || c;
}

export default function Wishes() {
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newWish, setNewWish] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newPriority, setNewPriority] = useState('medium');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [editPriority, setEditPriority] = useState('medium');

  const load = useCallback(() => {
    apiGet<{ data: Wish[]; total: number }>('/wishes').then((res) => setWishes(res.data)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!newWish.trim()) return;
    await apiPost('/wishes', { wish: newWish, category: newCategory, priority: newPriority });
    setNewWish('');
    setNewCategory('general');
    setNewPriority('medium');
    setShowAdd(false);
    load();
  }

  async function handleDelete(wishId: string) {
    await apiDelete(`/wishes/${wishId}`);
    load();
  }

  function startEdit(w: Wish) {
    setEditId(w.id);
    setEditText(w.wish);
    setEditCategory(w.category);
    setEditPriority(w.priority);
  }

  async function handleEditSave() {
    if (!editId || !editText.trim()) return;
    await apiPatch(`/wishes/${editId}`, { wish: editText, category: editCategory, priority: editPriority });
    setEditId(null);
    load();
  }

  // Group wishes by category
  const grouped = wishes.reduce<Record<string, Wish[]>>((acc, w) => {
    const cat = w.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(w);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Wuensche ({wishes.length})</h1>
        <button onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 bg-accent text-navy px-3 py-1.5 rounded text-sm font-semibold hover:opacity-90">
          <Plus size={14} /> Neuer Wunsch
        </button>
      </div>

      {/* Inline Add Form */}
      {showAdd && (
        <div className="bg-card border border-accent/30 rounded-lg p-4 space-y-3">
          <input
            value={newWish}
            onChange={(e) => setNewWish(e.target.value)}
            placeholder="Was wuenschst du dir von einem Job?"
            className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <div className="flex flex-wrap gap-2">
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
              className="bg-navy border border-border rounded px-3 py-1.5 text-sm text-text">
              {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
            <div className="flex gap-1">
              {PRIORITIES.map((p) => (
                <button key={p} onClick={() => setNewPriority(p)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold ${newPriority === p ? priorityColor(p) : 'bg-navy border border-border text-text-muted'}`}>
                  {p}
                </button>
              ))}
            </div>
            <button onClick={handleAdd} disabled={!newWish.trim()}
              className="flex items-center gap-1 bg-accent text-navy px-3 py-1.5 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50 ml-auto">
              <Check size={14} /> Speichern
            </button>
          </div>
        </div>
      )}

      {/* Grouped Wishes */}
      {Object.keys(grouped).length === 0 && !showAdd && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-text-muted">
          Noch keine Wuensche erfasst
        </div>
      )}

      {Object.entries(grouped).map(([cat, catWishes]) => (
        <div key={cat} className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-xs font-semibold text-text-muted mb-3">{categoryLabel(cat).toUpperCase()}</h2>
          <div className="space-y-2">
            {catWishes.map((w) => (
              <div key={w.id} className="flex items-center gap-2 group">
                {editId === w.id ? (
                  <>
                    <input value={editText} onChange={(e) => setEditText(e.target.value)}
                      className="flex-1 bg-navy border border-accent rounded px-2 py-1 text-sm text-text focus:outline-none"
                      onKeyDown={(e) => e.key === 'Enter' && handleEditSave()}
                    />
                    <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                      className="bg-navy border border-border rounded px-2 py-1 text-xs text-text">
                      {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                    </select>
                    <div className="flex gap-1">
                      {PRIORITIES.map((p) => (
                        <button key={p} onClick={() => setEditPriority(p)}
                          className={`px-2 py-1 rounded text-xs ${editPriority === p ? priorityColor(p) : 'bg-navy border border-border text-text-muted'}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <button onClick={handleEditSave} className="text-accent hover:text-accent/80"><Check size={14} /></button>
                    <button onClick={() => setEditId(null)} className="text-text-muted hover:text-text"><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <span className={`text-sm ${w.is_active ? 'text-text' : 'text-text-muted line-through'}`}>{w.wish}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${priorityColor(w.priority)}`}>{w.priority}</span>
                    <div className="flex gap-1 ml-auto opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => startEdit(w)} className="text-text-muted hover:text-text p-1"><Pencil size={13} /></button>
                      <button onClick={() => handleDelete(w.id)} className="text-text-muted hover:text-danger p-1"><Trash2 size={13} /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
