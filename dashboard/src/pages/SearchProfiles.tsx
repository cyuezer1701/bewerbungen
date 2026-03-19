import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

interface Profile {
  id: string; name: string; keywords: string; location: string | null;
  radius_km: number; min_match_score: number; is_active: number; created_at: string;
}

interface FormData {
  name: string; keywords: string; location: string; radius_km: number; min_match_score: number;
}

const emptyForm: FormData = { name: '', keywords: '', location: 'Schweiz', radius_km: 50, min_match_score: 65 };

export default function SearchProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  async function load() {
    const data = await apiGet<Profile[]>('/search-profiles');
    setProfiles(data);
  }
  useEffect(() => { load(); }, []);

  function openCreate() { setForm(emptyForm); setEditId(null); setShowModal(true); }
  function openEdit(p: Profile) {
    setForm({ name: p.name, keywords: p.keywords, location: p.location || '', radius_km: p.radius_km, min_match_score: p.min_match_score });
    setEditId(p.id); setShowModal(true);
  }

  async function handleSave() {
    if (editId) {
      await apiPatch(`/search-profiles/${editId}`, form);
    } else {
      await apiPost('/search-profiles', form);
    }
    setShowModal(false); load();
  }

  async function handleDelete(id: string) {
    await apiDelete(`/search-profiles/${id}`);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Suchprofile ({profiles.length})</h1>
        <button onClick={openCreate} className="flex items-center gap-2 bg-accent text-navy px-4 py-2 rounded text-sm font-semibold hover:opacity-90">
          <Plus size={14} /> Neues Profil
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {profiles.map((p) => (
          <div key={p.id} className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-base font-semibold text-text">{p.name}</h2>
              <div className="flex gap-1">
                <button onClick={() => openEdit(p)} className="p-1 text-text-muted hover:text-accent"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(p.id)} className="p-1 text-text-muted hover:text-danger"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {p.keywords.split(',').map((kw) => (
                <span key={kw} className="text-xs px-2 py-0.5 bg-accent/20 text-accent rounded">{kw.trim()}</span>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-text-muted">
              <div>📍 {p.location || 'k.A.'}</div>
              <div>📏 {p.radius_km} km</div>
              <div>🎯 Min. {p.min_match_score}%</div>
            </div>
          </div>
        ))}
        {profiles.length === 0 && (
          <div className="col-span-2 bg-card border border-border rounded-lg p-8 text-center text-text-muted">
            Keine Suchprofile vorhanden
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-text">{editId ? 'Profil bearbeiten' : 'Neues Profil'}</h2>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-muted">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text mt-1" />
              </div>
              <div>
                <label className="text-xs text-text-muted">Keywords (kommagetrennt)</label>
                <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  placeholder="DevOps, Cloud Engineer, SRE"
                  className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text mt-1" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-text-muted">Standort</label>
                  <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text mt-1" />
                </div>
                <div>
                  <label className="text-xs text-text-muted">Radius km</label>
                  <input type="number" value={form.radius_km} onChange={(e) => setForm({ ...form, radius_km: Number(e.target.value) })}
                    className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text mt-1" />
                </div>
                <div>
                  <label className="text-xs text-text-muted">Min Score</label>
                  <input type="number" value={form.min_match_score} onChange={(e) => setForm({ ...form, min_match_score: Number(e.target.value) })}
                    className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text mt-1" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleSave} className="flex-1 bg-accent text-navy py-2 rounded text-sm font-semibold hover:opacity-90">
                {editId ? 'Speichern' : 'Erstellen'}
              </button>
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-text-muted text-sm hover:text-text">Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
