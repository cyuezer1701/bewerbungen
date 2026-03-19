import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../api/client';
import { Save, Eye, EyeOff } from 'lucide-react';

const TABS = [
  'Job Suche', 'Anschreiben', 'Absender', 'E-Mail', 'Telegram', 'Gehalt', 'Follow-up', 'System',
];

type Settings = Record<string, string>;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiGet<Settings>('/settings').then(setSettings).catch(() => {});
  }, []);

  function update(key: string, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await apiPut('/settings', settings);
      setSaved(true);
    } finally { setSaving(false); }
  }

  function togglePassword(key: string) {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function Field({ label, settingKey, type = 'text', placeholder }: { label: string; settingKey: string; type?: string; placeholder?: string }) {
    const isSensitive = type === 'password';
    const isShown = showPasswords[settingKey];
    return (
      <div>
        <label className="text-xs text-text-muted">{label}</label>
        <div className="relative mt-1">
          <input
            type={isSensitive && !isShown ? 'password' : 'text'}
            value={settings[settingKey] || ''}
            onChange={(e) => update(settingKey, e.target.value)}
            placeholder={placeholder}
            className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text pr-8"
          />
          {isSensitive && (
            <button onClick={() => togglePassword(settingKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text">
              {isShown ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
        </div>
      </div>
    );
  }

  function Toggle({ label, settingKey }: { label: string; settingKey: string }) {
    const isOn = settings[settingKey] === 'true';
    return (
      <div className="flex items-center justify-between">
        <span className="text-sm text-text">{label}</span>
        <button onClick={() => update(settingKey, isOn ? 'false' : 'true')}
          className={`w-10 h-5 rounded-full transition ${isOn ? 'bg-accent' : 'bg-border'} relative`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${isOn ? 'left-5' : 'left-0.5'}`} />
        </button>
      </div>
    );
  }

  function NumberField({ label, settingKey, min, max }: { label: string; settingKey: string; min?: number; max?: number }) {
    return (
      <div>
        <label className="text-xs text-text-muted">{label}</label>
        <div className="flex items-center gap-3 mt-1">
          <input type="range" min={min || 0} max={max || 100} value={Number(settings[settingKey]) || 0}
            onChange={(e) => update(settingKey, e.target.value)}
            className="flex-1 accent-accent" />
          <span className="font-mono text-sm text-text w-12 text-right">{settings[settingKey] || 0}</span>
        </div>
      </div>
    );
  }

  const tabs: Record<number, React.ReactNode> = {
    0: ( // Job Suche
      <div className="space-y-4">
        <Field label="Such Keywords (kommagetrennt)" settingKey="search_keywords" placeholder="IT Manager, DevOps" />
        <Field label="Standort" settingKey="search_location" />
        <NumberField label="Radius (km)" settingKey="search_radius_km" min={10} max={200} />
        <NumberField label="Min Match Score (%)" settingKey="min_match_score" />
        <NumberField label="Max Jobs pro Tag" settingKey="max_jobs_per_day" min={5} max={50} />
        <Toggle label="LinkedIn Scraper" settingKey="scraper_linkedin_enabled" />
        <Toggle label="Indeed Scraper" settingKey="scraper_indeed_enabled" />
        <Toggle label="jobs.ch Scraper" settingKey="scraper_jobsch_enabled" />
        <Field label="Cron Schedule" settingKey="scraper_schedule" placeholder="0 7 * * *" />
      </div>
    ),
    1: ( // Anschreiben
      <div className="space-y-4">
        <div>
          <label className="text-xs text-text-muted">Stil</label>
          <div className="flex gap-2 mt-1">
            {['formal', 'modern', 'direkt'].map((s) => (
              <button key={s} onClick={() => update('cover_letter_style', s)}
                className={`px-4 py-2 rounded text-sm ${settings.cover_letter_style === s ? 'bg-accent text-navy' : 'bg-navy border border-border text-text'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-text-muted">Laenge</label>
          <div className="flex gap-2 mt-1">
            {[{ v: 'kurz', l: 'Kurz (~200W)' }, { v: 'mittel', l: 'Mittel (~300W)' }, { v: 'lang', l: 'Lang (~400W)' }].map((o) => (
              <button key={o.v} onClick={() => update('cover_letter_length', o.v)}
                className={`px-4 py-2 rounded text-sm ${settings.cover_letter_length === o.v ? 'bg-accent text-navy' : 'bg-navy border border-border text-text'}`}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
        <Toggle label="Keine Bindestriche" settingKey="cover_letter_no_hyphens" />
        <div>
          <label className="text-xs text-text-muted">Zusaetzliche Regeln</label>
          <textarea value={settings.cover_letter_custom_rules || ''} onChange={(e) => update('cover_letter_custom_rules', e.target.value)}
            placeholder="z.B. Erwaehne immer mein ITIL Zertifikat"
            className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text mt-1 h-24 resize-none" />
        </div>
      </div>
    ),
    2: ( // Absender
      <div className="space-y-4">
        <Field label="Name" settingKey="sender_name" />
        <Field label="E-Mail" settingKey="sender_email" />
        <Field label="Telefon" settingKey="sender_phone" />
        <Field label="Strasse" settingKey="sender_address_street" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="PLZ" settingKey="sender_address_zip" />
          <Field label="Ort" settingKey="sender_address_city" />
        </div>
        <Field label="Land" settingKey="sender_address_country" />
        {settings.sender_name && (
          <div className="bg-navy border border-border rounded p-4 text-sm text-text-muted">
            <p className="font-medium text-text">{settings.sender_name}</p>
            {settings.sender_address_street && <p>{settings.sender_address_street}</p>}
            {(settings.sender_address_zip || settings.sender_address_city) && (
              <p>{settings.sender_address_zip} {settings.sender_address_city}</p>
            )}
            {settings.sender_email && <p>{settings.sender_email}</p>}
            {settings.sender_phone && <p>{settings.sender_phone}</p>}
          </div>
        )}
      </div>
    ),
    3: ( // E-Mail
      <div className="space-y-4">
        <Field label="SMTP Host" settingKey="smtp_host" />
        <Field label="SMTP Port" settingKey="smtp_port" />
        <Field label="SMTP User" settingKey="smtp_user" />
        <Field label="SMTP Passwort" settingKey="smtp_pass" type="password" />
        <Field label="Betreff Template" settingKey="email_subject_template" placeholder="Bewerbung als {job_title}" />
        <Toggle label="BCC an sich selbst" settingKey="email_bcc_self" />
      </div>
    ),
    4: ( // Telegram
      <div className="space-y-4">
        <Field label="Bot Token" settingKey="telegram_bot_token" type="password" />
        <Field label="Chat ID" settingKey="telegram_chat_id" />
        <Toggle label="Taeglicher Report" settingKey="telegram_daily_report" />
        <Toggle label="Fehler Alerts" settingKey="telegram_error_alerts" />
      </div>
    ),
    5: ( // Gehalt
      <div className="space-y-4">
        <div>
          <label className="text-xs text-text-muted">Standard Waehrung</label>
          <div className="flex gap-2 mt-1">
            {['CHF', 'EUR'].map((c) => (
              <button key={c} onClick={() => update('salary_currency_default', c)}
                className={`px-4 py-2 rounded text-sm ${settings.salary_currency_default === c ? 'bg-accent text-navy' : 'bg-navy border border-border text-text'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-text-muted bg-navy border border-border rounded p-3">
          Diese Werte werden verwendet um die Gehaltsschaetzungen einzuordnen und dir zu sagen ob ein Job finanziell passt.
        </p>
      </div>
    ),
    6: ( // Follow-up
      <div className="space-y-4">
        <NumberField label="Erster Reminder nach (Tage)" settingKey="followup_first_days" min={7} max={60} />
        <NumberField label="Zweiter Reminder nach (Tage)" settingKey="followup_second_days" min={14} max={90} />
        <NumberField label="Auto Absage nach (Tage)" settingKey="followup_auto_reject_days" min={30} max={120} />
      </div>
    ),
    7: ( // System
      <div className="space-y-4">
        {/* Test Mode */}
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-warning">🧪 Test Mode</h3>
          <Toggle label="Test Mode aktivieren" settingKey="test_mode" />
          <Field label="Test E-Mail Adresse" settingKey="test_mode_email" placeholder="deine@email.com" />
          <p className="text-xs text-text-muted">Im Test Mode werden alle E-Mails an die Test-Adresse umgeleitet. Keine echten Bewerbungen.</p>
        </div>

        <Field label="Claude Model" settingKey="claude_model" />
        <NumberField label="Max parallele API Calls" settingKey="claude_max_parallel" min={1} max={20} />
        <Field label="Dashboard Port" settingKey="dashboard_port" />
        <Field label="API Token" settingKey="dashboard_api_token" type="password" />
      </div>
    ),
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text">Einstellungen</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 overflow-x-auto">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`px-3 py-1.5 rounded text-xs transition whitespace-nowrap shrink-0 ${activeTab === i ? 'bg-accent text-navy font-semibold' : 'text-text-muted hover:text-text'}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-card border border-border rounded-lg p-5">
        {tabs[activeTab]}
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 bg-accent text-navy px-4 py-2 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Speichere...' : 'Speichern'}
          </button>
          {saved && <span className="text-accent text-sm">Gespeichert!</span>}
        </div>
      </div>
    </div>
  );
}
