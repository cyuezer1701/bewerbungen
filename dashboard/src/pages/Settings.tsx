import { useEffect, useState } from 'react';
import { apiGet, apiPut, apiPost, apiDelete } from '../api/client';
import { Save, Eye, EyeOff, Play, Trash2 } from 'lucide-react';

const TABS = [
  'Job Suche', 'Anschreiben', 'Absender', 'E-Mail', 'Telegram', 'Gehalt', 'Follow-up', 'System',
];

type SettingsMap = Record<string, string>;

/* ---- Extracted sub-components (stable references → no re-mount on keystroke) ---- */

function Field({ label, settingKey, value, type = 'text', placeholder, onChange, isShown, onTogglePassword }: {
  label: string; settingKey: string; value: string; type?: string; placeholder?: string;
  onChange: (key: string, val: string) => void;
  isShown?: boolean; onTogglePassword?: (key: string) => void;
}) {
  const isSensitive = type === 'password';
  return (
    <div>
      <label className="text-xs text-text-muted">{label}</label>
      <div className="relative mt-1">
        <input
          type={isSensitive && !isShown ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(settingKey, e.target.value)}
          placeholder={placeholder}
          className="w-full bg-navy border border-border rounded px-3 py-2 text-sm text-text pr-8"
        />
        {isSensitive && onTogglePassword && (
          <button onClick={() => onTogglePassword(settingKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text">
            {isShown ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, isOn, onChange }: { label: string; isOn: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-text">{label}</span>
      <button onClick={onChange}
        className={`w-10 h-5 rounded-full transition ${isOn ? 'bg-accent' : 'bg-border'} relative`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${isOn ? 'left-5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function NumberField({ label, settingKey, value, min, max, onChange }: {
  label: string; settingKey: string; value: number; min?: number; max?: number;
  onChange: (key: string, val: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted">{label}</label>
      <div className="flex items-center gap-3 mt-1">
        <input type="range" min={min || 0} max={max || 100} value={value}
          onChange={(e) => onChange(settingKey, e.target.value)}
          className="flex-1 accent-accent" />
        <span className="font-mono text-sm text-text w-12 text-right">{value}</span>
      </div>
    </div>
  );
}

/* ---- Main Component ---- */

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [triggeringCron, setTriggeringCron] = useState(false);
  const [cronTriggered, setCronTriggered] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingTestData, setDeletingTestData] = useState(false);

  useEffect(() => {
    apiGet<SettingsMap>('/settings').then(setSettings).catch(() => {});
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

  async function handleTriggerCron() {
    setTriggeringCron(true);
    setCronTriggered(false);
    try {
      await apiPost('/cron/trigger');
      setCronTriggered(true);
    } finally { setTriggeringCron(false); }
  }

  async function handleDeleteTestData() {
    setDeletingTestData(true);
    try {
      await apiDelete('/test-data');
      setShowDeleteConfirm(false);
    } finally { setDeletingTestData(false); }
  }

  /* Helper: short aliases for the verbose prop passing */
  function f(label: string, settingKey: string, type?: string, placeholder?: string) {
    return <Field label={label} settingKey={settingKey} value={settings[settingKey] || ''} type={type}
      placeholder={placeholder} onChange={update} isShown={showPasswords[settingKey]} onTogglePassword={togglePassword} />;
  }
  function t(label: string, settingKey: string) {
    return <Toggle label={label} isOn={settings[settingKey] === 'true'} onChange={() => update(settingKey, settings[settingKey] === 'true' ? 'false' : 'true')} />;
  }
  function n(label: string, settingKey: string, min?: number, max?: number) {
    return <NumberField label={label} settingKey={settingKey} value={Number(settings[settingKey]) || 0} min={min} max={max} onChange={update} />;
  }

  const tabs: Record<number, React.ReactNode> = {
    0: ( // Job Suche
      <div className="space-y-4">
        {f('Such Keywords (kommagetrennt)', 'search_keywords', 'text', 'IT Manager, DevOps')}
        {f('Ausschluss Keywords (kommagetrennt)', 'exclude_keywords', 'text', 'Junior, Trainee, Pharma, Praktikum')}
        {f('Standort', 'search_location')}
        {n('Radius (km)', 'search_radius_km', 10, 200)}
        {n('Min Match Score (%)', 'min_match_score')}
        {n('Max Jobs pro Tag', 'max_jobs_per_day', 10, 100)}
        {t('jobs.ch Scraper', 'scraper_jobsch_enabled')}
        {t('JobSpy (Indeed, Glassdoor, Google)', 'scraper_jobspy_enabled')}
        {settings.scraper_jobspy_enabled === 'true' && (
          <div className="ml-4 space-y-3 border-l-2 border-border pl-4">
            {f('Quellen (kommagetrennt)', 'jobspy_sites', 'text', 'indeed,glassdoor,google')}
            {f('Land', 'jobspy_country', 'text', 'Switzerland')}
            {n('Max Alter (Stunden)', 'jobspy_hours_old', 24, 168)}
          </div>
        )}
        {f('Cron Schedule', 'scraper_schedule', 'text', '0 7 * * *')}
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
        {t('Keine Bindestriche', 'cover_letter_no_hyphens')}
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
        {f('Name', 'sender_name')}
        {f('E-Mail', 'sender_email')}
        {f('Telefon', 'sender_phone')}
        {f('Strasse', 'sender_address_street')}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {f('PLZ', 'sender_address_zip')}
          {f('Ort', 'sender_address_city')}
        </div>
        {f('Land', 'sender_address_country')}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {f('Kuendigungsfrist', 'notice_period')}
          {f('Verfuegbar ab', 'sender_available_from')}
        </div>
        <p className="text-xs text-text-muted">Kuendigungsfrist ist nur fuer deine Referenz. Im Anschreiben steht nur "Verfuegbar ab".</p>
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
        {f('SMTP Host', 'smtp_host')}
        {f('SMTP Port', 'smtp_port')}
        {f('SMTP User', 'smtp_user')}
        {f('SMTP Passwort', 'smtp_pass', 'password')}
        {f('Betreff Template', 'email_subject_template', 'text', 'Bewerbung als {job_title}')}
        {t('BCC an sich selbst', 'email_bcc_self')}
      </div>
    ),
    4: ( // Telegram
      <div className="space-y-4">
        {f('Bot Token', 'telegram_bot_token', 'password')}
        {f('Chat ID', 'telegram_chat_id')}
        {t('Taeglicher Report', 'telegram_daily_report')}
        {t('Fehler Alerts', 'telegram_error_alerts')}
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
        {n('Erster Reminder nach (Tage)', 'followup_first_days', 7, 60)}
        {n('Zweiter Reminder nach (Tage)', 'followup_second_days', 14, 90)}
        {n('Auto Absage nach (Tage)', 'followup_auto_reject_days', 30, 120)}
      </div>
    ),
    7: ( // System
      <div className="space-y-4">
        {/* Test Mode */}
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-warning">Test Mode</h3>
          {t('Test Mode aktivieren', 'test_mode')}
          {f('Test E-Mail Adresse', 'test_mode_email', 'text', 'deine@email.com')}
          <p className="text-xs text-text-muted">Im Test Mode werden alle E-Mails an die Test-Adresse umgeleitet. Keine echten Bewerbungen.</p>
        </div>

        {f('Claude Model', 'claude_model')}
        {n('Max parallele API Calls', 'claude_max_parallel', 1, 20)}
        {f('Dashboard Port', 'dashboard_port')}
        {f('API Token', 'dashboard_api_token', 'password')}

        {/* Cron + Test Data */}
        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-text">Aktionen</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleTriggerCron} disabled={triggeringCron}
              className="flex items-center gap-1 bg-accent text-navy px-4 py-2 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              <Play size={14} /> {triggeringCron ? 'Laueft...' : 'Cron manuell ausloesen'}
            </button>
            {cronTriggered && <span className="text-accent text-sm self-center">Ausgeloest!</span>}
          </div>
          <div>
            {!showDeleteConfirm ? (
              <button onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1 bg-danger/20 text-danger px-4 py-2 rounded text-sm hover:bg-danger/30">
                <Trash2 size={14} /> Test-Daten loeschen
              </button>
            ) : (
              <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 space-y-2">
                <p className="text-sm text-danger font-semibold">Wirklich alle Test-Daten loeschen?</p>
                <p className="text-xs text-text-muted">Diese Aktion kann nicht rueckgaengig gemacht werden.</p>
                <div className="flex gap-2">
                  <button onClick={handleDeleteTestData} disabled={deletingTestData}
                    className="flex items-center gap-1 bg-danger text-white px-3 py-1.5 rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                    <Trash2 size={13} /> {deletingTestData ? 'Loesche...' : 'Ja, loeschen'}
                  </button>
                  <button onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1.5 text-text-muted text-sm hover:text-text">Abbrechen</button>
                </div>
              </div>
            )}
          </div>
        </div>
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
