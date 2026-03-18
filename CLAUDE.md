# CLAUDE.md — AutoBewerber: Automatische Bewerbungs-Pipeline

## Projekt-Übersicht

**AutoBewerber** ist eine selbstgehostete, vollautomatische Bewerbungs-Pipeline auf einem Hetzner VPS.
Das System sucht täglich nach passenden Jobs, bewertet sie gegen den eigenen CV, generiert massgeschneiderte Bewerbungsschreiben als PDF und wird komplett über einen Telegram Bot gesteuert.

**Tech Stack:** Node.js + TypeScript, Claude API (claude-sonnet-4-20250514), Telegram Bot (Telegraf), Puppeteer (PDF), SQLite (Tracking), GitHub Actions CI/CD, Hetzner VPS (Ubuntu)

---

## Architektur

```
┌─────────────────────────────────────────────────────────┐
│  HETZNER VPS (Ubuntu)                                   │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │ Cron Job │───>│ Scraper  │───>│ Claude API       │   │
│  │ (täglich)│    │ Service  │    │ (Job Matching)   │   │
│  └──────────┘    └──────────┘    └──────────────────┘   │
│                       │                    │             │
│                       v                    v             │
│              ┌──────────────┐    ┌──────────────────┐   │
│              │   SQLite DB  │    │ Claude API       │   │
│              │  (Tracking)  │    │ (Anschreiben)    │   │
│              └──────────────┘    └──────────────────┘   │
│                       │                    │             │
│                       v                    v             │
│              ┌──────────────┐    ┌──────────────────┐   │
│              │ Telegram Bot │    │ PDF Generator    │   │
│              │  (Telegraf)  │    │ (Puppeteer)      │   │
│              └──────────────┘    └──────────────────┘   │
│                       │                    │             │
│                       v                    v             │
│              ┌─────────────────────────────────────┐    │
│              │  /bewerbungen/{firma}/               │    │
│              │    anschreiben.pdf                   │    │
│              │    lebenslauf.pdf                    │    │
│              │    zeugnisse.pdf                     │    │
│              └─────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Verzeichnisstruktur

```
auto-bewerber/
├── CLAUDE.md                          # Diese Datei
├── package.json
├── tsconfig.json
├── .env.example                       # Template für Umgebungsvariablen
├── .github/
│   └── workflows/
│       └── deploy.yml                 # GitHub Actions -> Hetzner VPS
├── src/
│   ├── index.ts                       # App Entry Point + Cron Setup
│   ├── config.ts                      # Env Variablen + Konfiguration
│   │
│   ├── scrapers/                      # Job Scraper Module
│   │   ├── index.ts                   # Scraper Orchestrator
│   │   ├── base-scraper.ts            # Abstract Base Class
│   │   ├── linkedin-scraper.ts        # LinkedIn Job Scraper
│   │   ├── indeed-scraper.ts          # Indeed Job Scraper
│   │   └── jobsch-scraper.ts          # jobs.ch / StepStone Scraper
│   │
│   ├── matching/                      # Job Matching via Claude API
│   │   ├── index.ts                   # Match Orchestrator
│   │   ├── cv-parser.ts              # CV einlesen + strukturieren
│   │   └── job-scorer.ts             # Claude API: Job vs CV Score + Gehaltsschätzung
│   │
│   ├── generator/                     # Bewerbungs-Generierung
│   │   ├── index.ts                   # Generator Orchestrator
│   │   ├── cover-letter.ts           # Claude API: Anschreiben generieren
│   │   ├── pdf-builder.ts            # Puppeteer: HTML -> PDF
│   │   └── templates/
│   │       ├── cover-letter.html     # HTML Template Anschreiben
│   │       └── styles.css            # PDF Styles
│   │
│   ├── bot/                           # Telegram Bot
│   │   ├── index.ts                   # Bot Setup + Commands
│   │   ├── handlers/
│   │   │   ├── jobs.ts               # /jobs — Neue Jobs anzeigen
│   │   │   ├── apply.ts              # /apply <id> — Bewerbung starten
│   │   │   ├── edit.ts               # /edit <id> — Anschreiben anpassen
│   │   │   ├── send.ts              # /send <id> — Bewerbung per Mail abschicken
│   │   │   ├── done.ts              # /done <id> — Portal-Bewerbung als gesendet markieren
│   │   │   ├── status.ts            # /status — Tracking Dashboard
│   │   │   └── settings.ts          # /settings — Suchkriterien ändern
│   │   └── keyboards.ts             # Inline Keyboards für Telegram
│   │
│   ├── mailer/                        # E-Mail Versand
│   │   ├── index.ts                   # Nodemailer Setup
│   │   └── templates.ts             # E-Mail Templates
│   │
│   ├── db/                            # Datenbank
│   │   ├── index.ts                   # SQLite Connection + Migrations
│   │   ├── schema.sql                # DB Schema
│   │   └── queries.ts               # Prepared Statements
│   │
│   └── utils/
│       ├── logger.ts                 # Winston Logger
│       ├── retry.ts                  # Retry Logic mit Exponential Backoff
│       └── sanitize.ts              # Input Sanitization
│
├── data/
│   ├── cv.pdf                         # Dein aktueller Lebenslauf
│   ├── cv-structured.json            # Geparstes CV als JSON
│   ├── zeugnisse/                    # Alle Zeugnisse als PDF
│   │   ├── arbeitszeugnis-helvetia.pdf
│   │   └── ...
│   └── bewerbungen/                  # Generierte Bewerbungen
│       └── {firma-datum}/
│           ├── anschreiben.pdf
│           ├── lebenslauf.pdf
│           └── komplett.pdf          # Merged: Anschreiben + CV + Zeugnisse
│
├── docker-compose.yml                 # Optional: Containerized Deployment
└── ecosystem.config.js               # PM2 Konfiguration
```

---

## Umgebungsvariablen (.env)

```env
# Claude API
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-20250514

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=deine-chat-id

# E-Mail (für Bewerbungsversand)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=deine@email.com
SMTP_PASS=app-password
SENDER_NAME=Can Nachname
SENDER_EMAIL=deine@email.com

# Job Suche Defaults
JOB_SEARCH_KEYWORDS=IT Service Desk,IT Coordinator,System Administrator,IT Manager
JOB_SEARCH_LOCATION=Schweiz
JOB_SEARCH_RADIUS_KM=50
JOB_MIN_MATCH_SCORE=65

# Pfade
CV_PATH=./data/cv.pdf
ZEUGNISSE_DIR=./data/zeugnisse
BEWERBUNGEN_DIR=./data/bewerbungen

# DB
DB_PATH=./data/autobewerber.db

# App
LOG_LEVEL=info
CRON_SCHEDULE=0 7 * * *
MAX_JOBS_PER_DAY=20
```

---

## Datenbank Schema (SQLite)

```sql
-- Jobs die gefunden wurden
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,                    -- UUID
    source TEXT NOT NULL,                   -- linkedin | indeed | jobsch
    source_id TEXT,                         -- Original ID von der Plattform
    source_url TEXT,                        -- Link zum Original-Inserat
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    description TEXT,                       -- Volltext der Stellenbeschreibung
    salary_range TEXT,                      -- Falls im Inserat angegeben
    salary_estimate_min INTEGER,            -- Claude Schätzung: Minimum (CHF/EUR brutto p.a.)
    salary_estimate_max INTEGER,            -- Claude Schätzung: Maximum
    salary_estimate_realistic INTEGER,      -- Claude Schätzung: Realistisch für Kandidat
    salary_currency TEXT DEFAULT 'CHF',     -- CHF | EUR
    salary_reasoning TEXT,                  -- Claude Begründung für Schätzung
    application_method TEXT,                -- email | portal | both
    application_url TEXT,                   -- Direkt-Link zum Bewerbungsportal
    application_email TEXT,                 -- E-Mail falls vorhanden
    posted_at TEXT,
    scraped_at TEXT DEFAULT (datetime('now')),
    match_score INTEGER,                    -- 0-100 via Claude API
    match_reasoning TEXT,                   -- Claude Begründung
    status TEXT DEFAULT 'new',              -- new | reviewed | applying | applied | interview | rejected | offer
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Generierte Bewerbungen
CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    cover_letter_text TEXT,                 -- Generierter Text
    cover_letter_pdf_path TEXT,             -- Pfad zur PDF
    full_package_pdf_path TEXT,             -- Merged PDF
    version INTEGER DEFAULT 1,             -- Versionierung bei Edits
    feedback TEXT,                          -- Dein Feedback via Telegram
    sent_at TEXT,                           -- Wann abgeschickt
    sent_via TEXT,                          -- email | portal | manual
    sent_to TEXT,                           -- E-Mail Adresse oder Portal URL
    follow_up_at TEXT,                      -- Wann Follow-up fällig (sent_at + 14 Tage)
    follow_up_count INTEGER DEFAULT 0,      -- Wie oft schon nachgefasst
    status TEXT DEFAULT 'draft',            -- draft | ready | sent | bounced
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Tracking / Timeline
CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT REFERENCES jobs(id),
    application_id TEXT REFERENCES applications(id),
    action TEXT NOT NULL,                   -- scraped | matched | generated | edited | sent | status_changed
    details TEXT,                           -- JSON mit Details
    created_at TEXT DEFAULT (datetime('now'))
);

-- Suchprofile
CREATE TABLE search_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,                     -- z.B. "IT Manager DACH"
    keywords TEXT NOT NULL,                 -- Komma-getrennt
    location TEXT,
    radius_km INTEGER DEFAULT 50,
    min_match_score INTEGER DEFAULT 65,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_match_score ON jobs(match_score);
CREATE INDEX idx_applications_job_id ON applications(job_id);
CREATE INDEX idx_activity_log_job_id ON activity_log(job_id);
```

---

## Module: Detail-Spezifikationen

### 1. Scraper Service (`src/scrapers/`)

**base-scraper.ts** — Abstract Base Class:
```typescript
interface ScrapedJob {
    sourceId: string;
    source: 'linkedin' | 'indeed' | 'jobsch';
    title: string;
    company: string;
    location: string;
    description: string;
    salaryRange?: string;
    sourceUrl: string;
    postedAt?: string;
    applicationMethod: 'email' | 'portal' | 'both';  // Wie man sich bewirbt
    applicationUrl?: string;                           // Direkt-Link zum Portal
    applicationEmail?: string;                         // E-Mail falls vorhanden
}

abstract class BaseScraper {
    abstract name: string;
    abstract scrape(keywords: string[], location: string): Promise<ScrapedJob[]>;
    protected abstract parseJobPage(html: string): ScrapedJob;
}
```

**linkedin-scraper.ts:**
- Nutze `https://www.linkedin.com/jobs/search/?keywords={}&location={}&f_TPR=r86400` (letzte 24h)
- LinkedIn blockiert aggressiv. Strategie: Puppeteer mit Stealth Plugin (`puppeteer-extra-plugin-stealth`)
- Alternativ: LinkedIn RSS Feed falls verfügbar, oder RapidAPI LinkedIn Jobs API als Fallback
- User-Agent Rotation, Random Delays zwischen Requests (2-5 Sekunden)
- Maximal 20 Jobs pro Durchlauf scrapen
- WICHTIG: Kein Login verwenden, nur öffentlich zugängliche Inserate
- **Bewerbungsweg erkennen:** "Easy Apply" = portal (LinkedIn), externer Link = portal (Firmenwebsite), E-Mail im Inserat = email. Speichere den direkten Bewerbungslink.

**indeed-scraper.ts:**
- Nutze `https://ch.indeed.com/jobs?q={keywords}&l={location}&fromage=1` (letzte 24h)
- Puppeteer mit Stealth, ähnliche Anti-Detection wie LinkedIn
- Parse Jobtitel, Firma, Ort, Kurzbeschreibung von der Suchseite
- Dann Detail-Seite aufrufen für volle Beschreibung
- Rate Limiting: Max 1 Request pro 3 Sekunden
- **Bewerbungsweg erkennen:** "Jetzt bewerben" Button mit externer URL = portal, "Per E-Mail bewerben" = email. Extrahiere E-Mail Adressen aus dem Inserat-Text (Regex). Speichere den "Bewerben" Link als applicationUrl.

**jobsch-scraper.ts:**
- Nutze `https://www.jobs.ch/en/vacancies/?term={keywords}&location={location}`
- jobs.ch ist weniger aggressiv mit Blocking
- Alternativ StepStone API falls verfügbar
- Parse ebenfalls Suchresultate + Detail-Seiten
- **Bewerbungsweg erkennen:** jobs.ch zeigt meist "Online bewerben" (= portal) oder "Per E-Mail bewerben". Detail-Seite enthält oft direkten Link zum Firmenportal. Extrahiere E-Mail und Portal-URL.

**Orchestrator (index.ts):**
- Führe alle aktiven Scraper parallel aus
- Dedupliziere Jobs basierend auf Titel + Firma (Levenshtein Distance > 0.85 = Duplikat)
- Speichere nur neue Jobs in DB (check source_id)
- Logge Scraper Ergebnisse und Fehler

### 2. Job Matching (`src/matching/`)

**cv-parser.ts:**
- Lese CV aus `data/cv.pdf` mit `pdf-parse`
- Sende Volltext an Claude API mit folgendem Prompt:

```
Du bist ein CV-Analyst. Extrahiere aus dem folgenden Lebenslauf eine strukturierte JSON-Repräsentation.

Antwort NUR als JSON, kein Markdown, keine Backticks:
{
    "name": "...",
    "current_role": "...",
    "years_experience": 0,
    "skills_technical": ["..."],
    "skills_soft": ["..."],
    "certifications": ["..."],
    "languages": [{"language": "...", "level": "..."}],
    "industries": ["..."],
    "education": [{"degree": "...", "institution": "...", "year": "..."}],
    "work_history": [{"role": "...", "company": "...", "duration": "...", "highlights": ["..."]}],
    "key_achievements": ["..."],
    "preferred_roles": ["..."],
    "salary_expectation": "...",
    "location_preference": "..."
}
```
- Cache das Ergebnis in `data/cv-structured.json`
- Re-Parse nur wenn CV-Datei sich ändert (Datei-Hash vergleichen)

**job-scorer.ts:**
- Für jeden neuen Job: Sende Job-Beschreibung + strukturiertes CV an Claude API
- Prompt:

```
Du bist ein Karriereberater und Gehaltsexperte für den DACH-Markt (Schweiz, Deutschland, Österreich).
Bewerte wie gut dieser Job zum Kandidaten passt und schätze das realistische Gehalt.

KANDIDAT:
{cv-structured.json}

JOB:
Titel: {title}
Firma: {company}
Ort: {location}
Beschreibung: {description}
Gehalt laut Inserat: {salaryRange || "nicht angegeben"}
Bewerbungsweg: {applicationMethod}

GEHALTSSCHÄTZUNG REGELN:
- Berücksichtige den Standort (Schweiz zahlt deutlich mehr als DE/AT)
- Berücksichtige Firmengrösse und Branche
- Berücksichtige die Erfahrung und Skills des Kandidaten
- "realistic" = was der Kandidat realistisch verhandeln kann basierend auf seinem Profil
- Falls das Inserat ein Gehalt nennt, nutze das als Ankerpunkt
- Währung: CHF für Schweiz, EUR für DE/AT
- Immer Brutto Jahresgehalt

Antwort NUR als JSON, kein Markdown, keine Backticks:
{
    "match_score": 0-100,
    "reasoning": "2-3 Sätze warum dieser Score",
    "matching_skills": ["Skills die passen"],
    "missing_skills": ["Skills die fehlen"],
    "salary_estimate": {
        "min": 95000,
        "max": 130000,
        "realistic": 115000,
        "currency": "CHF",
        "reasoning": "Begründung: Marktlage, Region, Firmengrösse, Kandidat-Profil"
    },
    "recommendation": "apply | maybe | skip",
    "cover_letter_focus": "Worauf das Anschreiben fokussieren sollte"
}
```
- Nur Jobs mit match_score >= JOB_MIN_MATCH_SCORE weiter verarbeiten
- Batch Processing: Max 10 Claude API Calls parallel (Rate Limiting beachten)

### 3. Bewerbungs-Generator (`src/generator/`)

**cover-letter.ts:**
- Generiere Anschreiben via Claude API
- Prompt:

```
Du bist ein erfahrener Bewerbungscoach für den DACH-Markt (Schweiz/Deutschland/Österreich).
Schreibe ein professionelles, individuelles Bewerbungsschreiben.

REGELN:
- Sprache: Deutsch (Schweizer Stil, kein ß, kein Genitiv-s wo unüblich)
- Kein generischer Floskeln ("mit grossem Interesse habe ich...")
- Direkt, selbstbewusst, konkret
- Bezug auf spezifische Anforderungen aus der Stellenbeschreibung
- Erwähne 2-3 konkrete Erfolge/Projekte aus dem CV die relevant sind
- Länge: ca. 250-350 Wörter
- Keine Emojis, keine Aufzählungszeichen im Fliesstext
- KEINE Bindestriche verwenden, sie wirken maschinell
- Format: Absender, Datum, Empfänger, Betreff, Anrede, 3-4 Absätze, Gruss

KANDIDAT:
{cv-structured.json}

JOB:
{job details}

FOKUS-EMPFEHLUNG VOM MATCHING:
{cover_letter_focus aus job-scorer}

Antwort als reiner Text (kein Markdown), bereit für PDF-Generierung.
```

**pdf-builder.ts:**
- Nutze Puppeteer um HTML Template -> PDF zu rendern
- Template in `src/generator/templates/cover-letter.html`:
  - Sauberes, professionelles Layout
  - Absender-Block oben rechts
  - Empfänger links
  - Datum
  - Betreff fett
  - Fliesstext
  - Unterschrift (optional: Signatur-Bild einbetten)
- Page Size: A4
- Margin: 2.5cm links/rechts, 2cm oben/unten
- Font: Arial oder Helvetica, 11pt
- Nach Generierung: Merge mit CV + Zeugnisse via `pdf-lib` zu einem Komplett-PDF

### 4. Telegram Bot (`src/bot/`)

**Commands:**

| Command | Beschreibung |
|---------|-------------|
| `/start` | Begrüssung + Übersicht |
| `/jobs` | Zeige neue Jobs mit Score, Gehalt, Bewerbungsweg (Inline Buttons) |
| `/apply <id>` | Starte Bewerbungsprozess für Job |
| `/preview <id>` | Zeige generiertes Anschreiben als Text |
| `/edit <id> <feedback>` | Anschreiben überarbeiten mit deinem Feedback |
| `/send <id>` | Bewerbung per E-Mail abschicken (nur bei email/both Jobs) |
| `/done <id>` | Markiere Portal-Bewerbung als abgeschickt |
| `/status` | Übersicht aller Bewerbungen nach Status |
| `/stats` | Statistiken: Jobs/Woche, Bewerbungen, Rücklaufquote, Ø Gehalt |
| `/search add <keywords>` | Neues Suchprofil hinzufügen |
| `/search list` | Aktive Suchprofile anzeigen |
| `/search remove <id>` | Suchprofil deaktivieren |
| `/update <id> <status>` | Job-Status manuell ändern (interview, rejected, offer) |

**Job-Karte Format (IMMER so anzeigen):**
```
🎯 Job #42 — Match: 85%

📌 Senior IT Coordinator
🏢 Zurich Insurance
📍 Zürich, Schweiz
💰 CHF 110'000 – 130'000 (realistisch: ~120'000)
📝 Portal-Bewerbung

⭐ Match: Cloud Infra, ITIL, Teamführung
⚠️ Gap: SAP Kenntnisse

[Details] [Bewerben] [Skip]
```

WICHTIG: Gehalt und Bewerbungsweg müssen IMMER sichtbar sein in jeder Job-Ansicht. Kein Job wird ohne diese Infos angezeigt.

**Bewerbungs-Flow je nach Methode:**

FLOW A — Portal-Bewerbung (application_method = 'portal'):
```
Du: /apply 42

Bot: 📄 Anschreiben für Job #42 wird generiert...

Bot: ✅ Bewerbung #42 ready!
     📌 Senior IT Coordinator @ Zurich Insurance
     💰 ~CHF 120'000
     
     📎 Anschreiben (v1) — 310 Wörter
     📎 Komplett-Paket (Anschreiben + CV + Zeugnisse)
     
     [Preview Anschreiben] [PDF herunterladen] [Bearbeiten]

Du: [PDF herunterladen]

Bot: 📄 Hier sind deine Dateien:
     1. anschreiben_zurich-insurance.pdf
     2. komplett_zurich-insurance.pdf
     
     🔗 Zum Bewerbungsportal:
     https://careers.zurich.com/job/12345
     
     Wenn hochgeladen, tippe /done 42

Du: /done 42

Bot: ✅ Job #42 als "applied (portal)" markiert.
     📅 Follow-up Reminder in 14 Tagen.
```

FLOW B — E-Mail Bewerbung (application_method = 'email'):
```
Du: /apply 42

Bot: 📄 Anschreiben für Job #42 wird generiert...

Bot: ✅ Bewerbung #42 ready!
     📌 IT Manager @ Swisscom
     💰 ~CHF 135'000
     📧 jobs@swisscom.com
     
     📎 Anschreiben (v1)
     📎 Komplett-Paket
     
     [Preview] [Per Mail senden] [Bearbeiten]

Du: [Per Mail senden]

Bot: 📧 Bewerbung an jobs@swisscom.com gesendet!
     📎 Anhang: komplett_swisscom.pdf (3 Seiten)
     📅 Follow-up Reminder in 14 Tagen.
```

FLOW C — Beides verfügbar (application_method = 'both'):
```
Bot: ✅ Bewerbung #42 ready!
     📌 DevOps Engineer @ ABB
     💰 ~CHF 125'000
     📧 hr@abb.com
     🔗 https://careers.abb.com/job/789
     
     [Per Mail senden] [Portal öffnen + PDF] [Bearbeiten]
```

**Inline Keyboards (kontextabhängig):**
- Job-Liste: [Details] [Bewerben] [Skip]
- Nach Generierung (Portal): [Preview] [PDF herunterladen] [Bearbeiten]
- Nach Generierung (E-Mail): [Preview] [Per Mail senden] [Bearbeiten]
- Nach Generierung (Beides): [Per Mail senden] [Portal + PDF] [Bearbeiten]
- Nach Absendung: [Interview erhalten] [Absage erhalten] [Angebot erhalten]
- Follow-up Reminder: [Status updaten] [Nachfassen] [Archivieren]

**Tägliche Benachrichtigung (nach Cron):**
```
📊 AutoBewerber Daily Report

🔍 {n} neue Jobs gefunden
⭐ {n} mit Match Score > 65%
💰 Gehaltsspanne heute: CHF 95'000 – 145'000

Top 5 Matches:

1. 🎯 85% | Senior IT Coordinator
   🏢 Zurich Insurance | 📍 Zürich
   💰 ~CHF 120'000 | 📝 Portal
   
2. 🎯 78% | IT Service Manager
   🏢 Swisscom | 📍 Bern
   💰 ~CHF 135'000 | 📧 Mail
   
3. 🎯 72% | System Engineer
   🏢 ABB | 📍 Baden
   💰 ~CHF 110'000 | 📝 Portal

📈 Diese Woche: 3 beworben, 1 Interview, 0 Absagen

Tippe /jobs für Details oder /apply <nr> zum Bewerben
```

**Follow-up System:**
- 14 Tage nach Bewerbung: Reminder "Noch keine Rückmeldung für Job #42 bei Zurich Insurance. [Nachfassen] [Absage markieren] [Warten]"
- 30 Tage: Zweiter Reminder
- 45 Tage: "Wahrscheinlich Absage. [Als abgelehnt markieren] [Weiter warten]"

### 5. Mailer Service (`src/mailer/`)

- Nodemailer mit SMTP
- Sende Bewerbung als E-Mail mit PDF Attachments
- Template: Kurzes Begleitmail + Bewerbungsunterlagen im Anhang
- Tracking: Speichere sent_at, sent_to in DB
- Optional: BCC an eigene Adresse zur Kontrolle

### 6. Tracking & Analytics (`src/db/`)

**Status Flow:**
```
new -> reviewed -> applying -> applied -> interview -> offer
                                      \-> rejected
```

**Activity Log:** Jede Aktion wird geloggt (scraped, matched, generated, edited, sent, status_changed)

---

## GitHub Actions CI/CD (.github/workflows/deploy.yml)

```yaml
name: Deploy AutoBewerber

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install & Build
        run: |
          npm ci
          npm run build

      - name: Deploy to Hetzner VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/auto-bewerber
            git pull origin main
            npm ci --production
            npm run build
            pm2 restart auto-bewerber || pm2 start ecosystem.config.js
```

---

## PM2 Konfiguration (ecosystem.config.js)

```javascript
module.exports = {
  apps: [{
    name: 'auto-bewerber',
    script: './dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true
  }]
};
```

---

## Implementierungs-Reihenfolge

Baue das Projekt in dieser Reihenfolge, jeder Schritt muss funktional sein bevor der nächste beginnt:

### Phase 1: Foundation
1. `npm init` + TypeScript + ESLint Setup
2. `src/config.ts` — Env Variablen laden mit `dotenv` + Validation mit `zod`
3. `src/db/` — SQLite Setup mit `better-sqlite3`, Schema Migration, Query Helpers
4. `src/utils/logger.ts` — Winston Logger mit File + Console Transport

### Phase 2: Telegram Bot (Grundgerüst)
5. `src/bot/index.ts` — Telegraf Bot mit `/start` und `/status` Command
6. Testen: Bot antwortet auf Telegram

### Phase 3: Scraper
7. `src/scrapers/base-scraper.ts` — Abstract Class
8. `src/scrapers/indeed-scraper.ts` — Indeed zuerst (am einfachsten)
9. `src/scrapers/linkedin-scraper.ts` — LinkedIn mit Stealth
10. `src/scrapers/jobsch-scraper.ts` — jobs.ch
11. `src/scrapers/index.ts` — Orchestrator + Deduplication
12. Testen: Scraper findet Jobs, speichert in DB

### Phase 4: Matching
13. `src/matching/cv-parser.ts` — CV -> JSON via Claude API
14. `src/matching/job-scorer.ts` — Jobs bewerten via Claude API
15. Testen: Jobs haben Match Scores

### Phase 5: Bot Integration
16. `/jobs` Command — Zeige neue Jobs mit Scores + Inline Buttons
17. `/apply` Command — Trigger Bewerbungsgenerierung
18. Tägliche Cron Benachrichtigung via Bot

### Phase 6: Bewerbungs-Generierung
19. `src/generator/cover-letter.ts` — Anschreiben via Claude API
20. `src/generator/templates/` — HTML Template
21. `src/generator/pdf-builder.ts` — HTML -> PDF via Puppeteer
22. PDF Merging: Anschreiben + CV + Zeugnisse
23. `/preview`, `/edit` Commands im Bot

### Phase 7: Versand & Tracking
24. `src/mailer/index.ts` — Nodemailer Setup
25. `/send` Command im Bot
26. `/status`, `/stats`, `/update` Commands
27. Activity Logging

### Phase 8: Deployment
28. GitHub Actions Workflow
29. PM2 Setup auf Hetzner VPS
30. Cron Schedule konfigurieren
31. Monitoring: PM2 Status + Error Alerts via Telegram

---

## Abhängigkeiten (package.json)

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.0.0",
    "node-cron": "^3.0.0",
    "nodemailer": "^6.9.0",
    "pdf-lib": "^1.17.0",
    "pdf-parse": "^1.1.1",
    "puppeteer": "^22.0.0",
    "puppeteer-extra": "^3.3.0",
    "puppeteer-extra-plugin-stealth": "^2.11.0",
    "telegraf": "^4.16.0",
    "uuid": "^9.0.0",
    "winston": "^3.11.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "@types/node-cron": "^3.0.0",
    "@types/nodemailer": "^6.4.0",
    "@types/uuid": "^9.0.0",
    "typescript": "^5.4.0",
    "tsx": "^4.0.0"
  }
}
```

---

## Wichtige Regeln für die Implementierung

1. **KEIN ß verwenden** — Schweizer Deutsch: immer "ss" statt "ß"
2. **Keine Bindestriche in generierten Texten** — wirken maschinell und unnatürlich
3. **Error Handling überall** — Jeder externe Call (Scraper, Claude API, SMTP) braucht try/catch mit Retry Logic
4. **Rate Limiting** — Claude API: max 10 parallel, Scraper: 1 Request pro 3 Sekunden
5. **Logging** — Jede wichtige Aktion loggen, Fehler immer mit Stack Trace
6. **Idempotent** — Scraper darf keine Duplikate erzeugen, Re-Runs müssen safe sein
7. **Graceful Shutdown** — SIGTERM/SIGINT Handler für sauberes Herunterfahren
8. **Alle Pfade relativ zum Projektroot** — Nutze `path.resolve(__dirname, '...')` oder Config
9. **Telegram Sicherheit** — Prüfe immer `ctx.chat.id === TELEGRAM_CHAT_ID` bevor Commands ausgeführt werden
10. **PDF Qualität** — A4, professionelles Layout, keine Artefakte, Fonts eingebettet

---

## Scraper Legalität & Ethics

- Nur öffentlich zugängliche Inserate scrapen
- Kein Login/Account-Zugriff auf LinkedIn/Indeed
- Respektiere robots.txt
- Rate Limits einhalten
- Daten nur für persönlichen Gebrauch
- Keine Weitergabe oder kommerzielle Nutzung der gescrapten Daten
- Falls eine Plattform API-Zugang anbietet, bevorzuge die API

---

## Fallback Strategien

Falls Scraper blockiert werden:
1. **LinkedIn**: Wechsle auf Google Jobs API oder RapidAPI LinkedIn Scraper
2. **Indeed**: Wechsle auf Indeed RSS Feed oder Google Jobs
3. **jobs.ch**: Wechsle auf jobs.ch API (falls verfügbar) oder direkte Google Suche `site:jobs.ch {keywords}`
4. **Generell**: Implementiere Proxy Rotation (Bright Data / ScraperAPI) als optionalen Layer

---

## Starte die Implementierung mit Phase 1 und arbeite dich sequenziell durch.
## Teste nach jeder Phase bevor du zur nächsten gehst.
## Committe nach jeder funktionalen Phase.
