# Invoice Generator — Implementation Plan (v2)

## Context

A small team (5–20 people) at Creowis needs to generate, send, and review invoices without standing up any infrastructure. Every team member runs the same `invoice` CLI on their laptop. There is **no role split in the codebase** — what you see is determined by which IMAP folder you point at:

- A regular user points at their own provider's **Sent folder** → they see only what they've sent.
- The person who manages `hello@creowis.com` (the "inbox manager") points at **INBOX** of that shared mailbox → they see every invoice the team has emailed in.

Email is the canonical pipeline: every invoice that gets sent is preserved by the mail provider forever. The local SQLite database is a derived index, rebuildable at any time with `invoice sync --backfill`.

The system is deliberately minimal: no hosted server, no OAuth, no SaaS, no daemons, no background polling. Sync is manual — the user clicks a button or runs a command. The dashboard is a tiny Hono app that runs on `127.0.0.1` when the user wants it.

## Architecture

```
   Each team member's laptop:
   ┌────────────────────────────────────────────┐
   │  invoice CLI  +  Hono dashboard            │
   │  (one binary, one code path, one role)     │
   │                                            │
   │      reads/writes via InvoiceStore         │
   │                  │                         │
   │                  ▼                         │
   │     ~/.invoice/local.db (SQLite)           │
   └────────────────────────────────────────────┘
                    ▲       │
       IMAP sync    │       │  SMTP send
       (manual)     │       │  (per-user creds)
                    │       ▼
   ┌────────────────────────────────────────────┐
   │  Mail provider — the canonical store       │
   │  • Regular user: their own Sent folder     │
   │  • Inbox manager: INBOX of hello@creowis   │
   └────────────────────────────────────────────┘
```

**Two truths shape every other decision:**

1. **Email is the source of truth.** Lose the laptop, the SQLite, anything — re-sync rebuilds it.
2. **Folder choice = scope.** No `auth.ts`, no `roles()`, no `invoice admin` namespace. The codebase has no concept of "admin." There is only `imap.folder` in config.

## Why this satisfies every constraint

| Concern                     | How it's addressed                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| No hosting bill             | Everything runs on the user's laptop. Mail provider is whatever the team already pays for.       |
| No ops                      | Nothing to keep alive. Manual sync only — no daemons, no timers.                                 |
| Minimal backend code        | One Hono server, a handful of routes, server-rendered JSX. No bundler, no build step.            |
| Self-contained              | Once synced, the dashboard works fully offline.                                                  |
| Real query/filter/sort      | SQLite + `better-sqlite3` + the `core/queries.ts` module.                                        |
| Recent + backfill ingestion | `invoice sync` (incremental, watermarked by IMAP UID) and `--backfill` / `--since` (historical). |
| Paid/unpaid + overdue       | `payment_status` column + a query-time overdue predicate. Toggleable from CLI or dashboard.      |
| Aggregates                  | SQL `GROUP BY` queries powering `/analytics`.                                                    |
| CSV export                  | Streamed from SQLite via `core/csv.ts`; same code from CLI and dashboard.                        |
| Users see only their own    | Their `imap.folder` is set to their own Sent folder; that's the only thing their CLI ever reads. |
| Team-wide view              | The inbox manager's `imap.folder = INBOX` against the shared mailbox.                            |
| Highlight extra fields      | `Invoice.custom` map; row badge when non-empty.                                                  |

## Tech stack

- **Language**: Node.js 20 + TypeScript (`strict: true` from day one).
- **CLI framework**: `commander` + `@inquirer/prompts`.
- **SMTP send**: `nodemailer`.
- **IMAP read**: `imapflow` + `mailparser`.
- **Local DB**: `better-sqlite3` — synchronous, fast, single-file.
- **Secret storage**: [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring) — active, modern N-API native bindings; replaces the archived `keytar`. Wraps macOS Keychain / Windows Credential Manager / libsecret.
- **Dashboard server**: [Hono](https://hono.dev/). Lightweight, no Next.js, no NextAuth, no app router.
- **Dashboard rendering**: [Hono JSX](https://hono.dev/docs/guides/jsx) — server-rendered HTML. **No bundler, no build step, no React on the client.**
- **Dashboard interactivity**: vanilla `fetch` in a single `client.js` file (sync button, paid/unpaid toggle).
- **Open in default app**: [`open`](https://www.npmjs.com/package/open) for the few places we want to launch a URL/file.
- **Email body rendering (v1)**: plain HTML template string in `packages/cli/src/email.ts`. Upgrade path documented: replace with a single React Email component if/when invoices need to look polished for external customers.

**Eliminated from v1 explicitly**: `pdfkit`, `keytar`, Next.js, Tailwind, NextAuth, React on client, any bundler. Eliminated from the runtime path: PDF generation entirely.

## Project layout

```
invoice-generator/
├── PLAN.md                       # this file
├── CLAUDE.md
├── README.md
├── package.json                  # workspaces root
├── tsconfig.base.json
└── packages/
    ├── shared/                   # types/constants used everywhere
    │   └── src/
    │       ├── invoice.ts        # Invoice type, DEFAULT_FIELDS, number-format renderer
    │       ├── email-format.ts   # subject template, X-Invoice-Generator header, attachment naming
    │       └── config-schema.ts  # Zod schema; single source of truth for config types
    ├── core/                     # storage-agnostic logic; imported by CLI and dashboard
    │   └── src/
    │       ├── store.ts          # InvoiceStore interface (the migration boundary)
    │       ├── sqlite-store.ts   # the only InvoiceStore implementation in v1
    │       ├── imap.ts           # imapflow wrapper: list folders, fetch messages from a folder
    │       ├── ingest.ts         # mailparser → SqliteStore.upsert; SAME function called by CLI sync and dashboard /sync
    │       ├── queries.ts        # filter/sort/aggregate; takes an InvoiceStore
    │       ├── csv.ts            # CSV streaming
    │       └── git.ts            # git shell-out helpers (Phase 7)
    ├── cli/                      # the `invoice` command
    │   └── src/
    │       ├── index.ts          # commander entry; no role gating
    │       ├── store.ts          # ~/.invoice/ paths + config IO
    │       ├── secrets.ts        # @napi-rs/keyring wrapper (service: "invoice-cli")
    │       ├── email.ts          # nodemailer wrapper + HTML body template (plain string for v1)
    │       └── commands/
    │           ├── init.ts       # interactive setup; folder picker via imap.list()
    │           ├── config.ts     # get / set / unset / edit / validate / doctor
    │           ├── new.ts        # interactive invoice creation
    │           ├── list.ts       # filter/sort over the local DB
    │           ├── preview.ts    # opens dashboard URL for the invoice + dumps JSON to stdout
    │           ├── send.ts       # interactive recipient confirm (--yes to skip) → SMTP send
    │           ├── sync.ts       # IMAP folder → SqliteStore (manual; --backfill / --since)
    │           ├── mark.ts       # paid/unpaid
    │           ├── export.ts     # CSV
    │           ├── dashboard.ts  # spawns Hono server, opens browser
    │           ├── whoami.ts
    │           └── repo/         # Phase 7: init/status/commit/push/log
    └── dashboard/                # Hono — runs on 127.0.0.1:3000 when invoked
        └── src/
            ├── server.ts         # Hono app; mounts routes + serves /public
            ├── routes/
            │   ├── pages.tsx     # GET /invoices, /invoices/:id, /analytics — server-rendered JSX
            │   ├── api-sync.ts   # POST /sync — calls core/ingest
            │   ├── api-status.ts # PATCH /invoices/:id/status — paid/unpaid
            │   ├── api-list.ts   # GET /invoices, GET /invoices/:id — JSON for client JS
            │   └── api-export.ts # GET /export/csv — streams core/csv
            ├── views/
            │   ├── layout.tsx    # base HTML shell (links style.css, client.js)
            │   ├── invoice-list.tsx
            │   ├── invoice-detail.tsx
            │   └── analytics.tsx
            └── public/
                ├── style.css     # one stylesheet, no preprocessor
                └── client.js     # vanilla fetch for the two interactive widgets
```

Key invariants:

- **One bin**: `packages/cli/` produces a single `invoice` command. No `admin` subcommand namespace anywhere.
- **One InvoiceStore**: `SqliteStore` is the only impl in v1. The interface exists so a future `PostgresStore` can be dropped in without touching anything else.
- **One sync function**: `core/ingest.ts` is called identically by `invoice sync` (CLI) and `POST /sync` (Hono). Behavior cannot drift.
- **`~/.invoice/` is the single config dir.**

## Invoice data model

```ts
// packages/shared/src/invoice.ts
export const DEFAULT_FIELDS = [
  'invoiceNumber', // user-defined display format from invoice.numberFormat config
  'issueDate',
  'dueDate',
  'fromName',
  'fromEmail', // sender — typed at init, embedded in every invoice
  'customerName',
  'customerEmail',
  'lineItems', // [{ description, quantity, unitPrice }]
  'currency', // ISO 4217
  'notes',
] as const;

export interface Invoice {
  id: string; // UUID — system-generated. The real key everywhere.
  default: Record<string, unknown>; // values for DEFAULT_FIELDS
  custom: Record<string, unknown>; // anything else
  status: 'draft' | 'sent';
  sentAt?: string;
  recipients?: { to: string[]; cc?: string[]; bcc?: string[] };
  paymentStatus: 'paid' | 'unpaid';
  paidAt?: string;
}
```

### UUID vs invoice number — the contract

- **`id` (UUID)** is the only real key. Used as the primary key in SQLite, the basename of the JSON sidecar, the git filename if the repo feature is enabled. **Never duplicates, never user-visible.**
- **`default.invoiceNumber`** is a display string built from `config.invoice.numberFormat`. Template variables: `{SEQ}`, `{YYYY}`, `{MM}`, `{DD}`. Examples: `CREOWIS-2026-AK-{SEQ}`, `INV-{YYYY}-{MM}-{SEQ}`. **Format is changeable mid-flight** — old invoices keep their old number; new invoices use the new format. Collisions are harmless because the UUID is the real key.

The `default` / `custom` split makes "highlight invoices with extra fields" a one-liner: `Object.keys(invoice.custom).length > 0`.

## CLI commands

The single `invoice` binary. No role gating, no subcommand namespaces beyond `config` and (Phase 7) `repo`.

### Top-level

| Command                                              | Behavior                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invoice init`                                       | Interactive setup. Prompts for `name`, `email`, currency, invoice number format, SMTP host/port/user/app-password, IMAP host/port/user/app-password. **Lists IMAP folders via `imapflow.list()` and asks the user to pick** (regular team members pick their Sent folder; the inbox manager picks INBOX of the shared mailbox). Creates `~/.invoice/local.db`. Re-running is idempotent.                           |
| `invoice config get/set/unset/edit/validate/doctor`  | All config operations. `doctor` walks every required key + checks keychain entries.                                                                                                                                                                                                                                                                                                                                |
| `invoice whoami`                                     | Prints `name`, `email`, configured `imap.folder`, and which mail account the IMAP creds belong to.                                                                                                                                                                                                                                                                                                                 |
| `invoice new`                                        | Interactive walkthrough of default fields, then `Add additional fields? (y/N)` loop. Saves draft via `SqliteStore.upsert`.                                                                                                                                                                                                                                                                                         |
| `invoice list [--filter ...]`                        | Filter flags: `--paid / --unpaid / --overdue / --has-custom / --customer / --since / --due-before / --due-after / --sort <field>`. Same `core/queries.ts` powers it.                                                                                                                                                                                                                                               |
| `invoice preview <id>`                               | Pretty-prints the JSON to stdout AND opens the dashboard's invoice detail page (`http://127.0.0.1:3000/invoices/<id>`) in the default browser. If the dashboard isn't running, prints a hint.                                                                                                                                                                                                                      |
| `invoice send <id> [flags]`                          | **Interactive recipient confirmation by default.** Renders to/cc/bcc from `email.recipients` recipe + the per-invoice line items, shows the user a summary, asks "Send? [y/N]". Flags: `--to <email>`, `--cc <email>`, `--bcc <email>` (override recipients for this send only); `--yes` (skip the confirmation prompt). Email contains an HTML body and a single attachment: `invoice-<number>.json`. **No PDF.** |
| `invoice sync [--backfill] [--since <date>]`         | Pulls new messages from `imap.folder` matching `X-Invoice-Generator:1`, parses sidecars, upserts into the DB. Manual only — no timers, no daemons.                                                                                                                                                                                                                                                                 |
| `invoice mark <id> paid \| unpaid`                   | Updates `payment_status` and `paid_at`.                                                                                                                                                                                                                                                                                                                                                                            |
| `invoice export csv [--filter ...] [--out file.csv]` | Streams CSV (stdout by default). Same filter grammar as `invoice list`.                                                                                                                                                                                                                                                                                                                                            |
| `invoice dashboard [--port 3000]`                    | Spawns the Hono server bound to `127.0.0.1`, opens the browser. Server runs in foreground; Ctrl+C stops it.                                                                                                                                                                                                                                                                                                        |

### Phase 7 (opt-in): git-backed storage of `~/.invoice/data/`

`~/.invoice/data/` (a separate folder containing JSON snapshots of every invoice) can become a git repo. The mail provider remains the canonical source — git is a secondary mirror for users who want extra durability or audit trail. We never touch the GitHub API; `git push` uses whatever credentials the user's git already has.

| Command                                                | Behavior                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoice repo init [--remote <url>]`                   | `git init` in `~/.invoice/data/`, initial commit. Asks `Auto-commit on every change? (y/N)` and `Auto-push after each commit? (y/N)`; answers go to `git.autoCommit` / `git.autoPush`. |
| `invoice repo status / commit [-m <msg>] / push / log` | Manual operations.                                                                                                                                                                     |

When `git.autoCommit = true`, every state-changing command (`new`, `mark`, `sync`) ends with a commit. Push behavior is controlled separately so users get rich local history without forcing a network round-trip on every action. Push failures never block the action that triggered them.

### Local layout

```
~/.invoice/
├── config.json     # name, email, smtp.{host,port,user}, imap.{host,port,user,folder}, email.recipients, invoice.{numberFormat,nextSeq}, git.*
├── local.db        # SQLite — derived from imap.folder; rebuildable via re-sync
└── data/           # Phase 7: optional JSON snapshots, optionally a git repo
    └── invoices/<uuid>.json
```

**Passwords are NOT in `~/.invoice/`** — they live in the OS keychain via `@napi-rs/keyring` under service `invoice-cli`:

| Account             | Stored            | Used by                           |
| ------------------- | ----------------- | --------------------------------- |
| `smtp-app-password` | SMTP app password | `invoice send`                    |
| `imap-app-password` | IMAP app password | `invoice sync`, dashboard `/sync` |

`config.json` contains no secrets.

## Storage abstraction: `InvoiceStore` (migration boundary)

```ts
// packages/core/src/store.ts
export interface InvoiceStore {
  list(filter?: InvoiceFilter, sort?: SortSpec): Promise<Invoice[]>;
  get(id: string): Promise<Invoice | null>;
  upsert(invoice: Invoice): Promise<void>;
  delete(id: string): Promise<void>;
  count(filter?: InvoiceFilter): Promise<number>;
  aggregate(spec: AggregateSpec): Promise<AggregateResult>;
}

export interface InvoiceFilter {
  text?: string;
  dueBefore?: string;
  dueAfter?: string;
  paymentStatus?: 'paid' | 'unpaid';
  overdue?: boolean;
  hasCustomFields?: boolean;
  fromEmail?: string;
  customerName?: string;
}
```

All filtering, aggregation, CSV export, and dashboard pages take an `InvoiceStore` and a typed filter/aggregate spec. **No SQL or filesystem APIs anywhere outside `core/sqlite-store.ts`.**

This is the explicit migration boundary. Today's only impl is `SqliteStore`. A future migration to a hosted DB (Fly.io + Postgres, Supabase, etc.) is a _new file added_ (`postgres-store.ts`), not a codebase rewrite. The other half of the migration is config-driven: `storage.backend = 'postgres'` and `storage.connectionUrl = '...'` switches the runtime store. No code path changes.

## Configuration

A single `~/.invoice/config.json`. Validated by a Zod schema in `packages/shared/src/config-schema.ts` — single source of truth for runtime validation and TypeScript types. **Override order, highest wins**: CLI flag → env var (`INVOICE_*`) → `config.json` → built-in default. **Secrets never go here.**

| Key                                                                                                                                                                                | Purpose                                                           | Phase                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| **Identity**                                                                                                                                                                       |
| `name`, `email`                                                                                                                                                                    | Sender identity                                                   | 1                       |
| `company.name`, `company.address`, `company.phone`, `company.website`, `company.taxId`                                                                                             | Printed on the HTML invoice + From header                         | 4 (HTML invoice design) |
| `branding.primaryColor`, `branding.fontFamily`, `branding.logoUrl`                                                                                                                 | Visual design of the HTML invoice                                 | 4                       |
| **Invoice defaults**                                                                                                                                                               |
| `currency`                                                                                                                                                                         | Default currency code                                             | 1                       |
| `invoice.numberFormat` (string with `{SEQ}/{YYYY}/{MM}/{DD}`), `invoice.nextSeq` (integer)                                                                                         | Display-format generation                                         | 1                       |
| `invoice.defaultDueDays`                                                                                                                                                           | `dueDate = issueDate + N`                                         | 1                       |
| `invoice.defaultTaxRate`, `invoice.taxLabel`                                                                                                                                       | Tax line                                                          | 4                       |
| `invoice.defaultNotes`, `invoice.paymentInstructions`, `invoice.dateFormat`, `invoice.currencyFormat`                                                                              | HTML invoice content + formatting                                 | 4                       |
| **Email recipients (recipe)**                                                                                                                                                      |
| `email.recipients.to: string[]`                                                                                                                                                    | Default `to` list (e.g. `["hello@creowis.com"]`)                  | 1                       |
| `email.recipients.cc: string[]`, `email.recipients.bcc: string[]`                                                                                                                  | Default cc/bcc                                                    | 1                       |
| `email.subjectTemplate`, `email.bodyTemplate`                                                                                                                                      | Customizable subject/body                                         | 5                       |
| `email.replyTo`                                                                                                                                                                    | Reply-to header                                                   | 5                       |
| **SMTP**                                                                                                                                                                           |
| `smtp.host`, `smtp.port`, `smtp.user`                                                                                                                                              | Connection (password in keychain)                                 | 1                       |
| **IMAP / sync**                                                                                                                                                                    |
| `imap.host`, `imap.port`, `imap.user`                                                                                                                                              | Connection (password in keychain)                                 | 1                       |
| `imap.folder`                                                                                                                                                                      | **Folder to sync from. The only thing that scopes what you see.** | 1                       |
| `sync.maxBackfillMonths`                                                                                                                                                           | Cap on `--backfill`                                               | 2                       |
| **Storage / migration**                                                                                                                                                            |
| `storage.backend` (`sqlite` in v1)                                                                                                                                                 | Active store implementation                                       | 1                       |
| `storage.dbPath`                                                                                                                                                                   | Override `~/.invoice/local.db`                                    | 3                       |
| **Dashboard**                                                                                                                                                                      |
| `dashboard.port`, `dashboard.host`                                                                                                                                                 | Bind address (default `127.0.0.1:3000`)                           | 5                       |
| `dashboard.theme`, `dashboard.defaultSort`, `dashboard.defaultFilter`                                                                                                              | UI prefs                                                          | 5/6                     |
| **Git**                                                                                                                                                                            |
| `git.enabled`, `git.remote`, `git.autoCommit`, `git.autoPush`, `git.commitMessageTemplate`, `git.pushRetries`                                                                      | Phase-7 git-backed storage                                        | 7                       |
| **CLI behavior**                                                                                                                                                                   |
| `cli.editor`, `cli.confirmBeforeSend` (default `true`), `cli.openPdfAfterPreview`                                                                                                  | UX knobs (`--yes` flag overrides `confirmBeforeSend`)             | 3                       |
| `cli.locale`, `cli.logLevel`                                                                                                                                                       | Misc                                                              | 3                       |
| **LLM (deferred to Phase 9)**                                                                                                                                                      |
| `llm.provider` (`ollama`/`lmstudio`/`openai-compatible`/`disabled`), `llm.endpoint`, `llm.model`, `llm.temperature`, `llm.maxTokens`, `llm.systemPromptOverride`, `llm.features.*` | Future chat                                                       | 9                       |

**Phase-1 essentials**: `name`, `email`, `currency`, `email.recipients.to`, `smtp.*`, `imap.{host,port,user,folder}`, `invoice.{numberFormat,nextSeq,defaultDueDays}`, `storage.backend`. The Zod schema in Phase 1 declares all keys above with sensible defaults — later phases just light up consumers.

### Things that explicitly do NOT go in config

- Passwords / API keys — keychain only.
- Per-invoice data — `SqliteStore`.
- Cacheable filesystem or git state.
- Telemetry — there is none.

## Email format (the contract between sender CLI and ingesting CLI)

- **Subject**: `[Invoice] {invoiceNumber} — {customerName} — {total} {currency}`
- **Custom header**: `X-Invoice-Generator: 1`. Sync queries IMAP for messages with this header in the configured folder. Reliable; doesn't depend on subject formatting.
- **HTML body**: human-readable summary of all default + custom fields. Plain template string in v1 (`packages/cli/src/email.ts`); React Email is the upgrade path when invoices need to look polished for external customers.
- **Attachment**: a single file, `invoice-<number>.json` — the `Invoice` object. **This is what sync parses.**
- **No PDF** anywhere in the email path.

## SQLite schema

`~/.invoice/local.db`:

```sql
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,                 -- UUID from JSON sidecar
  message_uid TEXT UNIQUE NOT NULL,    -- IMAP UID (folder-scoped, idempotent dedup)
  invoice_number TEXT NOT NULL,        -- display string; collisions allowed
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  issue_date TEXT,
  due_date TEXT,
  sent_at TEXT,
  currency TEXT,
  total REAL,                          -- computed from lineItems for sortable column
  has_custom_fields INTEGER NOT NULL,  -- 0/1
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  paid_at TEXT,
  raw_json TEXT NOT NULL               -- full Invoice object
);

CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_uid INTEGER                      -- highest IMAP UID seen
);

CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_from ON invoices(from_email);
CREATE INDEX idx_invoices_customer ON invoices(customer_name);
CREATE INDEX idx_invoices_payment ON invoices(payment_status);
CREATE INDEX idx_invoices_has_custom ON invoices(has_custom_fields);
```

"Overdue" is a query-time predicate: `payment_status = 'unpaid' AND due_date < date('now')`. Not a stored column.

**No `pdf_blob` column.** No PDFs anywhere.

## Identity & isolation

There is no role separation in the codebase. The CLI's behavior is determined by `imap.folder`.

- **Identity**: typed at `invoice init` (`name`, `email`). Embedded in every invoice as `fromName` / `fromEmail`. Trust-based — sender attribution is what the sender claims.
- **Isolation**: each install of `invoice` reads only the folder listed in its own `imap.folder`. A regular team member's folder is their personal Sent folder, which only contains mail they sent. The inbox manager's folder is INBOX of `hello@creowis.com`, which contains everyone's invoices.
- **No central authority** decides "you are admin." The system has no concept of admin. The inbox manager is just a person whose `imap.folder` happens to be the shared INBOX.
- **Credentials**: each user provides their own SMTP and IMAP credentials at init. SMTP is for sending from their personal address (e.g. `alice@creowis.com`). IMAP is to read their own Sent folder (or, for the inbox manager, the shared mailbox they have credentials for).
- **App passwords** in OS keychain via `@napi-rs/keyring`.

### Setup prerequisites

**Per team member** (one-time): generate an SMTP app password and an IMAP app password from your mail provider. (For most providers these are the same credential.) That's the entire setup. No OAuth client, no Google Cloud Console, no GitHub OAuth App.

### Accepted limitations

- **Sender attribution is trust-based.** The `fromName` / `fromEmail` in the sidecar are user-claimed. The cross-check available — and not implemented in v1 — is the email's DKIM-verified `From` header. If forging becomes a problem, add an allowlist in `core/ingest.ts` that compares the sidecar's `fromEmail` against the message's verified `From`.
- **App-password scope is broad.** A single app password typically grants both SMTP and IMAP. Rotate if exposed.

## Dashboard (Hono)

The dashboard is a Hono server that runs on the team member's laptop on `127.0.0.1:3000`. **No Next.js, no NextAuth, no React on the client, no bundler.** Hono JSX renders pages; a single `client.js` handles the two interactive widgets via `fetch`.

**Setup (one-time)**: `cd packages/dashboard && npm install`. That's it. There's no build step — TypeScript is compiled by `tsx` or `tsc --watch` during dev, or pre-compiled at install. The HTML and CSS ship as-is.

**Daily usage**:

1. Run `invoice dashboard`. Hono spawns on `127.0.0.1:3000` and the browser opens to `/invoices`.
2. The page shows what's in `local.db`. The list is rendered server-side as HTML.
3. Click "Sync now" → vanilla JS `fetch('/sync', { method: 'POST' })` → Hono calls `core/ingest` → DB updated → page refreshed.
4. In detail view, "Mark paid/unpaid" → `fetch('/invoices/:id/status', { method: 'PATCH' })`.

**Pages (all server-rendered JSX)**:

- `/invoices` — table with: invoice number, sender, customer, due date, total, sent date, payment status. Filters via query string (`?status=unpaid&overdue=1`). Sort via column-header links. Row badges: "⚠ Custom fields" (`has_custom_fields = 1`), "⏰ Overdue" (unpaid + past due). "Sync now" + "Export CSV" buttons in the header.
- `/invoices/:id` — full HTML invoice rendering (this is what `Print` uses). Custom fields highlighted. "Mark paid/unpaid" toggle (PATCH). "Print" button calls `window.print()` on the page itself — no PDF needed.
- `/analytics` — aggregate cards from `core/queries.ts/aggregate`: total billed, total outstanding, top senders, top customers, monthly trend, overdue count + total.

**API routes**:

- `POST /sync` — calls `core/ingest`.
- `PATCH /invoices/:id/status` — paid/unpaid.
- `GET /invoices`, `GET /invoices/:id` — JSON for the client JS (used by paid-toggle without full page reload).
- `GET /export/csv?<filter>` — streams from `core/csv.ts`.

**Bind**: `127.0.0.1` only. Documented as a security choice; do not change.

## Critical files to create

- `packages/shared/src/invoice.ts` — `Invoice` type + `DEFAULT_FIELDS` + `renderInvoiceNumber(format, seq, date)`.
- `packages/shared/src/email-format.ts` — subject template, header constant, attachment-naming helper.
- `packages/shared/src/config-schema.ts` — Zod schema; phase-1 essentials enforced, deferred-phase keys with defaults.
- `packages/core/src/store.ts` — `InvoiceStore` interface + filter/sort/aggregate types. **The migration boundary.**
- `packages/core/src/sqlite-store.ts` — the only impl in v1; schema + migrations on first open.
- `packages/core/src/imap.ts` — folder list (`imap.list()`), folder open, `fetchSince(uid)` returning parsed messages.
- `packages/core/src/ingest.ts` — message → JSON sidecar → `SqliteStore.upsert`. **Single function called from CLI sync and Hono `/sync`.**
- `packages/core/src/queries.ts` — filter/sort/aggregate logic; takes an `InvoiceStore`.
- `packages/core/src/csv.ts` — streaming CSV.
- `packages/core/src/git.ts` — Phase 7.
- `packages/cli/src/secrets.ts` — `@napi-rs/keyring` wrapper.
- `packages/cli/src/email.ts` — nodemailer + plain HTML template.
- `packages/cli/src/commands/init.ts` — interactive setup with folder picker.
- `packages/cli/src/commands/send.ts` — interactive recipient confirm (with `--yes` bypass) → SMTP send.
- `packages/cli/src/commands/sync.ts` — IMAP folder → DB.
- `packages/dashboard/src/server.ts` — Hono app.
- `packages/dashboard/src/views/*.tsx` — server-rendered pages.
- `packages/dashboard/src/public/client.js` — vanilla fetch for sync + paid toggle.

## Verification

End-to-end smoke test on a single machine. The same person plays both roles by running two installs (different `HOME` dirs, different `imap.folder`).

1. `npm install`, `npm run build`, `cd packages/cli && npm link`.
2. `invoice whoami` → "Not configured. Run `invoice init`."
3. `invoice init` → enter name/email; SMTP + IMAP creds for your own Gmail; **folder picker shows IMAP folders → pick your Sent folder**; set `email.recipients.to = ["hello@creowis.com"]`; configure `invoice.numberFormat = "TEST-{YYYY}-{SEQ}"`. Verify `~/.invoice/local.db` exists and `~/.invoice/config.json` has no passwords.
4. **Keychain sanity**: passwords are in `@napi-rs/keyring` under service `invoice-cli` (verify via Keychain Access on macOS or `secret-tool lookup` on Linux). Not in `config.json`.
5. `invoice new` → fill default fields, add a custom field `purchaseOrderNumber: PO-123`. Confirm row in `local.db` with `status = 'draft'`.
6. `invoice list` → draft shown.
7. `invoice send <id>` → **interactive recipient confirmation appears** showing `to: hello@creowis.com`. Override `--cc` to add yourself. Press `y`. Email lands in inbox + your own Sent folder.
8. Verify the email: `X-Invoice-Generator: 1` header, no PDF attachment, single `invoice-<number>.json` attachment, HTML body shows all fields.
9. `invoice send <other-id> --yes` → no prompt; sends immediately.
10. `invoice sync` → reports "1 new invoice synced" (from your own Sent folder). Re-run → 0 new (watermark works).
11. `invoice sync --backfill` → still 1 row (idempotency via `message_uid` UNIQUE).
12. `invoice list --has-custom` → shows the invoice; `--paid` → empty.
13. `invoice mark <id> paid` → `invoice list --paid` shows it.
14. `invoice export csv --paid --out paid.csv` → file has one row.
15. `invoice dashboard` → opens `http://127.0.0.1:3000/invoices`. Invoice appears with "⚠ Custom fields" badge.
16. Click "Sync now" → 0 new (consistent with CLI). Confirms shared code path.
17. Open detail → custom field highlighted; "Mark paid/unpaid" toggles; "Print" → `window.print()` shows the printable HTML invoice.
18. `/analytics` → 1 invoice, 1 paid, 0 overdue, totals match.
19. **Folder-scoping test**: in a second `HOME`, `invoice init` again with the same Gmail but `imap.folder = INBOX`. `invoice sync` → finds the email there too (since you sent it to `hello@creowis.com`, but here, from the same Gmail, INBOX won't have it — replace with a real second mailbox to verify). The point: this install only sees what's in _its_ folder.
20. **Configuration sanity**: `invoice config doctor` reports OK; rename `imap-app-password` in keychain → `invoice sync` errors with "IMAP login failed; run `invoice init`" and the doctor flags it.
21. **Number-format change**: `invoice config set invoice.numberFormat "NEW-{YYYY}-{SEQ}"`, `invoice new`, send → new invoice has the new prefix; old invoices retain their old number.
22. **Dashboard binding**: from another machine on the LAN, `curl http://<this-machine>:3000` → connection refused (only `127.0.0.1`).

## Execution phases

Phases are re-ordered to reflect the v2 architecture. The "PDF design" phase from v1 is gone; "user feature parity" and "personal dashboard" phases collapse because there is one role.

### Phase 1 — CLI MVP

**Goal**: end-to-end create + send + sync, on a single role, against the user's own mail account.

**Build**:

- Monorepo scaffold (`shared/`, `core/`, `cli/`).
- `shared/`: `Invoice` type, `DEFAULT_FIELDS`, `renderInvoiceNumber()`, email-format constants, **Zod config schema with all keys declared**.
- `core/`: `InvoiceStore` interface, `SqliteStore` impl, `imap.ts`, `ingest.ts`, `queries.ts` (basic).
- `cli/`: `secrets.ts` (@napi-rs/keyring), `email.ts` (nodemailer + plain HTML template), commands `init / config / new / list / send / sync / mark / whoami`.
- `init`: prompts for SMTP + IMAP creds; **lists folders and asks the user to pick**.
- `send`: interactive recipient confirmation; `--yes` to skip; `--to/--cc/--bcc` overrides; one JSON-sidecar attachment, no PDF.
- `~/.invoice/` with strict file modes (dir 0700, files 0600).

**Test**: configure → `new` → `send` → check the sent message has the header + attachment + HTML body. `sync` pulls it back into `local.db`. Re-run sync — 0 new.

### Phase 2 — CLI productivity

**Goal**: full CLI feature set against the local DB.

**Build**:

- `invoice list` filter flags: `--paid / --unpaid / --overdue / --has-custom / --customer / --since / --due-before / --due-after / --sort`.
- `invoice mark`, `invoice export csv`, `invoice preview`.
- `invoice sync --backfill / --since`.
- `core/csv.ts`, full `core/queries.ts` (filter + aggregate).

**Test**: corpus of varied invoices → each filter result matches a manual count. Export CSV row count matches list output.

### Phase 3 — CLI polish & isolation tests

**Goal**: smooth ergonomics + prove that folder-based scoping works.

**Build**:

- `invoice config doctor`, friendly setup hints.
- Robust error paths: SMTP/IMAP auth failure, malformed sidecar, missing fields, network timeouts.
- File-permission hardening on `~/.invoice/`.
- IMAP folder auto-detection refinements (special-use flags, provider quirks).

**Test**: Verification steps 19–22.

### Phase 4 — Customer-facing invoice + recurring billing

**Goal**: ship the production-quality HTML invoice (matching Creowis's existing design), customizable subject lines, and the full recurring-billing surface (clone / templates / scheduled).

**Build**:

- **Rendering polish**: branding from `config.branding.*` (color, font; logo deferred to Phase 5), date formatting from `config.invoice.dateFormat`, currency formatting (Indian comma-grouping for INR), tax line, payment-instructions block. Print-friendly via `@media print`. Verified across line-item counts.
- **Schema promotion**: company info, phone, customer address, bank details, tax fields, payment instructions move from the ad-hoc `invoice.custom` convention into formal `DEFAULT_FIELDS`. Each invoice is a complete snapshot of its data at creation time.
- **Subject line**: wire `mail.subjectTemplate` (already in config schema). Variables: `{invoiceNumber}/{customerName}/{total}/{currency}/{issueDate}/{dueDate}`. `--subject "..."` per-send override.
- **Recurring billing** — three layers:
  - `invoice clone <id>` (single shot — new draft from existing invoice).
  - `invoice template save / list / use / delete` (named patterns).
  - `invoice recurring create / list / show / delete / generate` (data model + manual generation; creates drafts only — sending still requires explicit `invoice send`).
- **Scheduling**: `invoice recurring schedule-help` prints platform-appropriate cron / launchd / Task Scheduler instructions. We do not run a daemon ourselves; users wire `invoice recurring generate` into their OS scheduler if they want auto-generation.

**Note**: this is the v1 plan's "final PDF design" phase, broadened to also cover productivity around the recurring use case ("same invoice monthly to the same customer"). The HTML invoice is the customer-facing rendering.

### Phase 4.5 (deferred) — React Email migration

**Goal**: replace `cli/src/email.ts`'s plain HTML template with a single React Email component. Same `renderInvoiceHtml()` signature, different internals. Triggered when invoices start going to external customers and need cross-client polish (Outlook quirks, dark-mode, etc.). The dashboard's print view (Phase 5) shares the component.

### Phase 5 — Hono dashboard MVP

**Goal**: read-only dashboard + sync + paid toggle.

**Build**:

- `packages/dashboard/` Hono server bound to `127.0.0.1`.
- Pages: `/invoices`, `/invoices/:id`, `/analytics` (skeleton).
- API: `POST /sync`, `PATCH /invoices/:id/status`, `GET /invoices(:id)`.
- Single `style.css` + `client.js`. No bundler.
- `invoice dashboard` command spawns server + opens browser.

**Test**: dashboard with seeded DB → list/filter/sort work; sync now matches CLI; paid toggle persists; print renders the HTML invoice.

### Phase 6 — Dashboard analytics & export

**Goal**: deeper reporting in the browser.

**Build**:

- `/analytics` cards + monthly-trend chart (small SVG, no chart library; if needed, a lightweight one).
- `GET /export/csv?<filter>` and "Export CSV" button.

**Test**: aggregates match `invoice export csv` output for the same filters.

### Phase 7 — Git-backed storage (opt-in)

**Goal**: `~/.invoice/data/` mirror, optionally pushed to a private GitHub repo.

**Build**:

- `core/git.ts` shell-out wrapper.
- `invoice repo init/status/commit/push/log`.
- Hooks: when `git.autoCommit = true`, every state-changing CLI command writes a JSON snapshot to `data/invoices/<uuid>.json` and commits.
- Push behavior governed by `git.autoPush`; failures logged, never fatal.

**Note**: The mail provider remains the canonical store. Git is a secondary mirror — re-syncing from email is what rebuilds `local.db` if it's lost. Git is for users who want versioned local history and an off-site backup independent of email.

### Phase 8 (optional, future) — Hosted DB migration

If/when local SQLite stops being enough:

1. Implement `core/postgres-store.ts` (or equivalent) against the existing `InvoiceStore` interface.
2. `invoice migrate <from> <to>` command streams rows via `from.list()` → `to.upsert()`.
3. Switch `storage.backend` and `storage.connectionUrl` in config.

The CLI commands, query layer, CSV export, dashboard, and ingestion don't change.

### Phase 9 (optional, future) — Local LLM + chat

`invoice chat` REPL with tool-calling against `InvoiceStore`. `LlmProvider` interface (parallel to `InvoiceStore`); Ollama and OpenAI-compatible servers as initial impls. Tools map directly to existing `core/queries.ts` methods — no new business logic. With `llm.provider = ollama`, no data leaves the machine.

### Cross-cutting (do as you go)

- **TypeScript strict** from day one.
- **ESLint + Prettier** in Phase 1.
- **Unit tests** for `core/ingest`, `core/queries` (against an in-memory `InvoiceStore`), and the IMAP folder picker. Highest-leverage test targets.

## Forward compatibility (the migration boundary)

`InvoiceStore` in `packages/core/src/store.ts` is the boundary that makes hosted-DB migration a single new file. Established in Phase 1 even though we only ship `SqliteStore`.

What stays portable across a migration to Fly.io / Postgres / Supabase / equivalent:

- `Invoice`, `DEFAULT_FIELDS` — pure data.
- `InvoiceFilter`, `AggregateSpec` — typed objects, not raw SQL.
- Every CLI command, dashboard page, CSV exporter, and ingestion call — they all see `InvoiceStore`.

What enables the migration:

- `migrate <from> <to>` command (Phase 8) streams rows through the interface.
- Same query suite tested against any new store impl.

What is NOT promised:

- `payment_status` toggle history (no event log) — re-marking is the only way to reach a state.
- IMAP watermark — re-syncing from the mail provider is the recovery path.

## Open questions resolved this round

- **`keytar` replacement** → `@napi-rs/keyring`.
- **PDF in send path** → eliminated entirely from v1.
- **Send confirmation** → on by default, `--yes` bypass.
- **IMAP folder auto-detection** → use `imapflow.list()` and present special-use-flagged folders first; full picker as fallback. Implemented in `init`.

## Phase 1 — Step-by-Step Build Order

This is the concrete implementation plan for Phase 1. Each step is a discrete, verifiable unit. Stop and run the checkpoint before moving on.

**Stack baseline (locked in at Step 0)**:

- Package manager: **pnpm with workspaces** (`pnpm-workspace.yaml`).
- Module system: **ESM** (`"type": "module"`), TypeScript `moduleResolution: "NodeNext"`, `target: "ES2022"`, `strict: true`.
- Build: **tsc per package** (`pnpm -r build` runs `tsc -b`). Dev runs the CLI via **`tsx`** so there's no rebuild loop.
- Tests: **Vitest** (root config, picks up `*.test.ts` siblings).
- Lint/format: ESLint flat config (`@typescript-eslint`, `eslint-config-prettier`) + Prettier.
- Internal deps use workspace protocol: `"@invoice/shared": "workspace:*"`.

**Naming conventions**: packages are `@invoice/shared`, `@invoice/core`, `@invoice/cli`. The bin produced by `@invoice/cli` is just `invoice`.

### Step 0 — Workspace bootstrap

**Files**:

- `package.json` (root) — scripts: `build`, `dev`, `test`, `lint`, `format`. No deps yet.
- `pnpm-workspace.yaml` — `packages: ['packages/*']`.
- `tsconfig.base.json` — strict, NodeNext, declaration maps on, `composite: true` for project refs.
- `tsconfig.json` (root) — references all four packages, no `files`.
- `.npmrc` — `engine-strict=true`, `node-linker=isolated`.
- `.editorconfig`, `.prettierrc.json`, `eslint.config.js` (flat config).
- `vitest.config.ts` — root config with workspace `include`.

**Deps**: `typescript`, `tsx`, `vitest`, `eslint`, `@typescript-eslint/*`, `prettier`, `eslint-config-prettier` (all dev).

**Checkpoint**: `pnpm install` succeeds; `pnpm exec tsc --build` is a no-op success; `pnpm test` reports 0 tests.

### Step 1 — `packages/shared`

**Files**:

- `packages/shared/package.json` — name `@invoice/shared`, `type: module`, exports map, `tsc -b` build script.
- `packages/shared/tsconfig.json` — extends base; `composite: true`; `outDir: dist`.
- `packages/shared/src/invoice.ts` — `DEFAULT_FIELDS`, `Invoice` interface, `renderInvoiceNumber(format, seq, date)` with `{SEQ}/{YYYY}/{MM}/{DD}` substitution.
- `packages/shared/src/email-format.ts` — `INVOICE_HEADER_NAME = 'X-Invoice-Generator'`, `INVOICE_HEADER_VALUE = '1'`, `subjectFor(invoice)`, `sidecarFilenameFor(invoiceNumber)`.
- `packages/shared/src/config-schema.ts` — Zod schema declaring **every** config key from the Configuration section (with defaults for everything except Phase-1 essentials, which are required). Export `type Config = z.infer<typeof ConfigSchema>`.
- `packages/shared/src/index.ts` — barrel re-export.
- Tests:
  - `invoice.test.ts` — template substitution for each var, zero-padded SEQ, mid-flight format change keeps old numbers untouched.
  - `config-schema.test.ts` — valid Phase-1 config parses; missing essential keys fail with a clear message; deferred keys get defaults.

**Runtime deps**: `zod`.

**Checkpoint**: `pnpm -F @invoice/shared test` → green.

### Step 2 — `packages/core` storage layer

**Files**:

- `packages/core/package.json` — depends on `@invoice/shared: workspace:*`.
- `packages/core/src/store.ts` — `InvoiceStore` interface, `InvoiceFilter`, `SortSpec`, `AggregateSpec`, `AggregateResult`.
- `packages/core/src/sqlite-store.ts` — opens `local.db`, runs schema + indexes from the plan's "SQLite schema" section on first open. Implements all `InvoiceStore` methods. `aggregate()` can be a stub that throws in Phase 1 (Phase 6 implements it).
- `packages/core/src/queries.ts` — currently a thin pass-through that just calls `store.list(filter, sort)`; exists as the seam for Phase 2 filter expansion.
- Tests:
  - `sqlite-store.test.ts` — opens a temp DB, upserts a few invoices, lists them, gets by id, deletes; verifies `message_uid` UNIQUE enforces idempotency.

**Runtime deps**: `better-sqlite3`. **Dev**: `@types/better-sqlite3`.

**Checkpoint**: `pnpm -F @invoice/core test` → green.

### Step 3 — `packages/core` IMAP + ingest

**Files**:

- `packages/core/src/imap.ts` — `connect(config, password)` returns an `imapflow` client; `listFolders(client)` returns folder names + special-use flags; `fetchSince(client, folder, lastUid)` async-iterates raw RFC 822 messages newer than `lastUid` that match the `X-Invoice-Generator` header.
- `packages/core/src/ingest.ts` — `ingest(store, client, folder, lastUid)`: drives `fetchSince`, parses each via `mailparser`, locates the `invoice-<n>.json` attachment, calls `store.upsert`, returns `{ syncedCount, newLastUid }`. **This is the single function called from CLI sync and dashboard `/sync`.**
- Tests:
  - `ingest.test.ts` — feeds a fixture raw email through a stubbed imapflow stream; asserts the right upsert payload reaches a fake `InvoiceStore`. Don't hit a real IMAP server in unit tests.

**Runtime deps**: `imapflow`, `mailparser`. **Dev**: `@types/mailparser`.

**Checkpoint**: `pnpm -F @invoice/core test` → green (all tests, including the new one).

### Step 4 — `packages/cli` foundation (no commands yet)

**Files**:

- `packages/cli/package.json` — bin `{ "invoice": "./dist/index.js" }`, depends on `@invoice/shared` and `@invoice/core`.
- `packages/cli/src/index.ts` — commander entry. Registers every Phase-1 command as a _stub_ that prints `not yet implemented`. Shebang `#!/usr/bin/env node`.
- `packages/cli/src/store.ts` — `INVOICE_DIR = ~/.invoice`, `configPath()`, `dbPath()`, `loadConfig()`, `saveConfig(partial)`. **Enforces `0700` on the dir and `0600` on `config.json`.**
- `packages/cli/src/secrets.ts` — wraps `@napi-rs/keyring`. Exports `getPassword(account)`, `setPassword(account, value)`, `deletePassword(account)`. Service constant `'invoice-cli'`. Accounts: `'smtp-app-password'`, `'imap-app-password'`.
- `packages/cli/src/email.ts` — `sendInvoice(invoice, recipients, smtp, password)` builds a `nodemailer` mail with: subject from `email-format`, plain HTML body (template string for v1), single JSON-sidecar attachment, `X-Invoice-Generator: 1` header. No PDF.
- Tests:
  - `email.test.ts` — feed a fixture invoice + recipients, assert the resulting `Mail.Options` object: subject text, headers, attachments[0] name and content. Mock the transport — no real SMTP.

**Runtime deps**: `@invoice/shared`, `@invoice/core`, `commander`, `@inquirer/prompts`, `@napi-rs/keyring`, `nodemailer`, `open`, `uuid`. **Dev**: `@types/nodemailer`, `@types/uuid`.

**Checkpoint**: `pnpm -F @invoice/cli build && pnpm -F @invoice/cli exec node dist/index.js --help` → prints commander help with all stubs listed. `pnpm test` → green.

### Step 5 — `init`, `whoami`, `config` commands

**Files**:

- `packages/cli/src/commands/init.ts` — interactive flow:
  1. Prompt `name`, `email`, `currency`, `invoice.numberFormat` (default `INV-{YYYY}-{SEQ}`).
  2. SMTP host/port/user + app password → keychain. Test connection (`nodemailer.verify()`); fail with clear message if rejected.
  3. IMAP host/port/user + app password → keychain. Test connection (`client.connect()`).
  4. **List folders** via `core/imap.listFolders`; surface special-use `\Sent` / `\Inbox` first; ask the user to pick. Save as `imap.folder`.
  5. Prompt `email.recipients.to[]` (CSV input, default `["hello@creowis.com"]`).
  6. Save config (Zod-validated); create `~/.invoice/local.db` via `SqliteStore` open.
- `packages/cli/src/commands/whoami.ts` — prints `name`, `email`, `imap.folder`, IMAP `user`. Or "Not configured. Run `invoice init`."
- `packages/cli/src/commands/config.ts` — `get [key]`, `set <key> <value>`, `unset <key>`, `edit` (`$EDITOR`), `validate`, `doctor`. `doctor` walks each Phase-1 required key + checks both keychain accounts exist.

**Wire in `index.ts`**.

**Checkpoint**: `invoice init` (via `pnpm exec tsx packages/cli/src/index.ts init`) completes a full happy-path setup against a real Gmail (with app passwords). `invoice whoami` prints the expected output. `invoice config doctor` → "all good".

### Step 6 — `new`, `list` commands

**Files**:

- `packages/cli/src/commands/new.ts`:
  1. Generate `id = uuid()`, compute `default.invoiceNumber` via `renderInvoiceNumber(config.invoice.numberFormat, config.invoice.nextSeq, today)`.
  2. Interactive walkthrough of `DEFAULT_FIELDS` (line items as a sub-loop).
  3. `Add additional fields? (y/N)` loop for `custom`.
  4. `store.upsert({ id, default, custom, status: 'draft', paymentStatus: 'unpaid' })`.
  5. Bump `config.invoice.nextSeq` and save.
- `packages/cli/src/commands/list.ts` — `store.list()` (no filters in Phase 1; Phase 2 adds them). Renders a small table: number, customer, due, status, sent.

**Checkpoint**: `invoice new` creates a draft. `invoice list` shows it.

### Step 7 — `send` command

**Files**:

- `packages/cli/src/commands/send.ts`:
  1. Look up invoice by `id`. Bail if `status === 'sent'` already.
  2. Compose recipients: start from `config.email.recipients`, apply `--to / --cc / --bcc` overrides (override fully, not merge).
  3. Render the body and a one-screen summary (recipients + line-item totals + invoice number).
  4. **Confirmation prompt** unless `--yes` (or `config.cli.confirmBeforeSend === false`): `Send? [y/N]`.
  5. `email.sendInvoice(...)` with both SMTP password from keychain.
  6. On success: `store.upsert({ ...invoice, status: 'sent', sentAt: now, recipients })`. On failure: don't update status; surface the error.

**Checkpoint**: `invoice send <id>` shows the confirm screen, sends, and the email arrives with the JSON sidecar attached and `X-Invoice-Generator: 1` in the raw headers. `invoice send <id> --yes` skips the prompt.

### Step 8 — `sync`, `mark` commands

**Files**:

- `packages/cli/src/commands/sync.ts`:
  1. Read `imap.*` from config + password from keychain.
  2. `client = await connect(...)`. Open `imap.folder`.
  3. Read `sync_state.last_uid` (or 0 if first run).
  4. `const { syncedCount, newLastUid } = await ingest(store, client, folder, lastUid)`.
  5. Update `sync_state.last_uid = newLastUid` if higher.
  6. Print `Synced N new invoice(s).`
- `packages/cli/src/commands/mark.ts` — `mark <id> paid|unpaid`. Updates `payment_status` and `paid_at`.

**Checkpoint**: `invoice send <id>` → `invoice sync` reports 1 new. Re-run → 0 new. `invoice mark <id> paid` updates the row.

### Step 9 — Phase 1 verification

**Run**:

- `pnpm test` — all unit tests green.
- `pnpm exec tsc --build` — clean.
- `pnpm lint` — clean.
- Walk the plan's full **Verification** section, steps 1–11 (Phase-1 covers `init` → `send` → `sync` → `mark`; later verification steps depend on commands that arrive in Phase 2+).

**Housekeeping**:

- Update `CLAUDE.md` "Phase status" → "Phase 1 complete. Active: Phase 2."
- Tag a `v0.1.0` commit.

### What is NOT in Phase 1 (don't accidentally build)

- `invoice preview` / `invoice export csv` — Phase 2.
- `invoice list` filter flags (`--paid`, `--overdue`, etc.) — Phase 2.
- `invoice sync --backfill / --since` — Phase 2.
- `invoice dashboard` and the entire `packages/dashboard/` — Phases 5–6.
- `invoice repo *` — Phase 7.
- Real HTML invoice design (logo, colors, etc.) — Phase 4. Phase 1's HTML body is a plain functional template.
- PDF generation — explicitly never.

## Phase 4 — Step-by-Step Build Order

Three concerns blended into one phase: customer-facing rendering polish, subject-line customization, and the full recurring-billing surface (clone + templates + scheduled). Steps are ordered so each lands a working sub-feature; stop and run the checkpoint before moving on.

**Decisions confirmed for Phase 4** (do not re-litigate):

- **Rendering target**: the Creowis-style invoice in `/home/ananya/Downloads/invoice.jpg` — blue title, meta block, two Billed By/Billed To rounded boxes, blue-header earnings table, side-by-side Bank Details + Total block with accounting underline, optional notes/extras.
- **Schema**: bank details, phone, customer address, company info, tax fields, and payment instructions are promoted from the `invoice.custom` convention into formal `DEFAULT_FIELDS`. Snapshot at `invoice new` time; documents are immutable.
- **Logo**: deferred to Phase 5 (no embedding, no URL handling, no `<img>` tag in the template).
- **`invoice new` prompts**: silent defaults from config for the new fields — no extra prompts in the wizard. Power users edit via `invoice config set` or by hand-editing config.
- **Recurring**: ship all three layers (clone, templates, schedules) plus a `schedule-help` command. **Generated invoices are always drafts** — sending stays explicit (`invoice send <id>`).
- **React Email**: explicitly NOT in Phase 4 — deferred to Phase 4.5.

### Step 1 — Schema additions + capture in `invoice new`

**Files**:

- `packages/shared/src/invoice.ts` — extend `DEFAULT_FIELDS` with: `companyName, companyAddress, companyPhone, companyWebsite, companyTaxId, customerAddress, bankAccountName, bankAccountNumber, bankIfsc, bankAccountType, bankName, taxRate, taxLabel, taxAmount, paymentInstructions`. No type-level change to `Invoice` (it's still `Record<string, unknown>` in `default`) — these are documentation/conventional keys.
- `packages/cli/src/commands/new.ts` — after collecting the existing fields, pull defaults from `config.company.*`, `config.invoice.{defaultTaxRate,taxLabel,defaultNotes,paymentInstructions}` and bake them into `invoice.default`. Compute `taxAmount = subtotal * taxRate` if `taxRate` is set. No new prompts.
- Tests: extend `invoice.test.ts` to cover the new fields' inclusion in `DEFAULT_FIELDS`.

**Checkpoint**: `invoice new` produces an invoice whose JSON sidecar has all the new fields populated (or omitted with sensible defaults), without any change to the prompt flow.

### Step 2 — Renderer rewrite to match the target design

**Files**:

- `packages/cli/src/email.ts` — refactor `renderInvoiceHtml`:
  - Accept `(invoice, opts: { branding, dateFormat, currencyFormat })` second arg (passed by `sendInvoice` from config).
  - Replace hardcoded `#3949ab` with `opts.branding.primaryColor` (fallback default).
  - Replace hardcoded font with `opts.branding.fontFamily` (fallback to current sans-serif stack).
  - Read company/bank/customer fields from `invoice.default` instead of `invoice.custom`. **Keep custom-fields fallback for one release** so existing in-flight invoices still render.
  - Move the total out of the table footer into a standalone block to the right of bank details, matching the image (label "Total ({currency})", accounting double-underline).
  - Render a tax line in the total block when `invoice.default.taxRate` is set.
  - Render a "Payment instructions" block below bank details when `invoice.default.paymentInstructions` is set.
- `packages/cli/src/format.ts` (new) — `formatDate(iso, format)` and `formatCurrency(amount, currency, format)`. Use `Intl.DateTimeFormat` for dates; `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` for INR; locale-derived for other currencies.
- Tests:
  - `format.test.ts` (new) — date formats (`YYYY-MM-DD`, `DD/MM/YYYY`, `MM-DD-YYYY`), INR comma-grouping (`12,34,567.89`), USD grouping (`12,345.67`).
  - `email.test.ts` (extend) — renderer reads from `default.companyName` etc.; legacy `custom.fromPhone` still works; branding overrides apply.

**Checkpoint**: render a sample invoice; visually compare to the target image side-by-side. INR formatting matches `₹12,34,567.89` style.

### Step 3 — `@media print` polish

**Files**:

- `packages/cli/src/email.ts` — add a `<style>` block (inline-style emails still need it for `window.print()`):
  - `@page { size: A4; margin: 1cm; }`
  - `@media print { body { background: white; } .no-print { display: none; } table { page-break-inside: avoid; } tr { page-break-inside: avoid; } }`
- Sample test: an invoice with 30 line items renders to multiple pages cleanly when printed from a browser.

**Checkpoint**: open the rendered HTML in a browser, hit Cmd/Ctrl+P, and verify the preview is clean (no awkward breaks mid-row, no email-only header chrome on paper).

### Step 4 — Subject line customization

**Files**:

- `packages/shared/src/email-format.ts` — add `renderSubject(template, invoice)` that substitutes `{invoiceNumber}/{customerName}/{total}/{currency}/{issueDate}/{dueDate}`.
- `packages/cli/src/email.ts` — `buildMailOptions` reads `config.mail.subjectTemplate ?? subjectFor(invoice)`. (Pass `subjectTemplate` through as the third arg, or read from config at the CLI layer and pass as a string.)
- `packages/cli/src/commands/send.ts` — add `--subject "<text>"` option; passes through to `sendInvoice`.
- Tests: `email-format.test.ts` covering template substitution + missing-field behavior.

**Checkpoint**: `invoice send <id> --subject "Custom prefix - {invoiceNumber}"` substitutes correctly; default behavior unchanged when no template + no flag.

### Step 5 — `invoice clone <id>`

**Files**:

- `packages/cli/src/commands/clone.ts` (new):
  - Look up invoice by id; bail if not found.
  - Deep-copy. Reset `id = uuid()`, `status = 'draft'`, `sentAt = undefined`, `recipients = undefined`, `paymentStatus = 'unpaid'`, `paidAt = undefined`.
  - Update `issueDate = today`, `dueDate = today + defaultDueDays`.
  - Compute new `invoiceNumber` via `renderInvoiceNumber(config.invoice.numberFormat, config.invoice.nextSeq, today)`. Bump `nextSeq` and save config.
  - `store.upsert(newInvoice)`.
  - Print summary; remind user they can edit before sending.
- `packages/cli/src/index.ts` — register.

**Checkpoint**: `invoice clone <old-id>` creates a draft with fresh dates and number, identical customer/line-items/bank-details/tax. `invoice list` shows both originals.

### Step 6 — Templates (save / list / use / delete)

**Files**:

- `packages/cli/src/templates.ts` (new) — path helper `templatesDir() = ~/.invoice/templates/`, JSON read/write helpers, list helper.
- `packages/cli/src/commands/template.ts` (new):
  - `invoice template save <id> <name>` — reads invoice, strips id/status/sentAt/recipients/paidAt/issueDate/dueDate, writes `~/.invoice/templates/<name>.json` (mode `0600`).
  - `invoice template list` — table of templates.
  - `invoice template use <name>` — generates a new invoice from a template (same logic as clone, but from a template file). Prints the resulting id.
  - `invoice template delete <name>` — confirms then unlinks.
- Tests: `template.test.ts` — round-trip save → list → use produces a valid Invoice; delete removes.

**Checkpoint**: `invoice template save <id> monthly-acme && invoice template use monthly-acme` produces a fresh draft for Acme.

### Step 7 — Recurring schedules (data model + commands)

**Files**:

- `packages/core/src/sqlite-store.ts` — schema add:
  ```sql
  CREATE TABLE IF NOT EXISTS recurring_invoices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('invoice','template')),
    source_ref TEXT NOT NULL,         -- invoice.id OR template name
    frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    next_run TEXT NOT NULL,
    last_run TEXT,
    created_at TEXT NOT NULL
  );
  ```
  Plus methods: `createRecurring`, `listRecurrings`, `getRecurring`, `deleteRecurring`, `updateRecurringRun(id, nextRun, lastRun)`, `findDueRecurrings(asOf)`.
- `packages/core/src/recurring.ts` (new) — pure function `computeNextRun(date, frequency): string`; `generateInvoiceFor(recurring, source): Invoice` — handles both `kind: 'invoice'` (look up + clone) and `kind: 'template'` (read file + materialize).
- `packages/cli/src/commands/recurring.ts` (new):
  - `invoice recurring create` — interactive: pick source (existing invoice id or template name), set frequency, start date, optional end date, optional name. Validates and inserts.
  - `invoice recurring list` — table: name, source, frequency, next_run, last_run.
  - `invoice recurring show <name>` — full detail.
  - `invoice recurring delete <name>` — confirms then deletes.
  - `invoice recurring generate [--dry-run]` — finds all due (next_run <= today), generates a draft for each, updates next_run + last_run. Prints what was created. `--dry-run` prints the plan without writing.
- Tests:
  - `recurring.test.ts` — `computeNextRun` for each frequency, leap-year/month-end edge cases.
  - `sqlite-store.test.ts` — extend to cover the new recurring table CRUD.

**Checkpoint**: create a monthly recurring with start_date in the past → `invoice recurring generate` produces drafts for each missed period and advances next_run. Re-run → produces 0. Drafts are visible in `invoice list`.

### Step 8 — Scheduling helper (`invoice recurring schedule-help`)

**Files**:

- `packages/cli/src/commands/recurring.ts` — add `schedule-help` subcommand that detects the OS and prints:
  - **Linux/macOS**: a recommended crontab entry (`5 9 * * * /full/path/to/invoice recurring generate >> ~/.invoice/recurring.log 2>&1`) plus `crontab -e` instructions; on macOS, also mention `launchd` as the modern alternative with a sample plist.
  - **Windows**: a `schtasks` command or PowerShell snippet for Task Scheduler.
  - Always reminds the user that generation creates drafts; sending stays explicit.

**Checkpoint**: `invoice recurring schedule-help` on Linux prints a copy-pasteable cron line; on macOS prints both cron and launchd; on Windows prints schtasks. Manual run of `invoice recurring generate` always works regardless.

### Step 9 — Verification + housekeeping

**Run**:

- `pnpm build && pnpm test && pnpm lint` — all green; expect ~80-90 tests total.
- Walk a new "Phase 4" section in `TESTING.md`: rendering matches target, dates and currencies format correctly, print preview is clean, subject line works with and without template, clone preserves customer + items, templates round-trip, recurring generates exactly as scheduled.

**Update**:

- `TESTING.md` — new sections for rendering, subject lines, clone, templates, recurring.
- `CLAUDE.md` — flip "Phase status" to "Phase 4 complete, Phase 2 still open / Phase 5 next" with deviations recorded (the `custom` → `default` migration, the `mail.subjectTemplate` repurposing from Phase 5 to Phase 4, etc.).

### Deviations to expect (flag in CLAUDE.md when they land)

- **Custom-field → DEFAULT_FIELDS migration**: pre-existing invoices with bank/phone/address in `custom` continue to render correctly because the renderer falls back to `custom.*` when `default.*` is empty. Phase 5 polish can drop the fallback after enough time has passed.
- **Logo deferred to Phase 5**: the renderer has no `<img>` slot in Phase 4. Plan-1 v2 had logos in Phase 4; we explicitly deferred.
- **`mail.subjectTemplate` promoted from Phase 5 to Phase 4**: small, low-risk; lives next to the other email rendering work.
- **Recurring generates drafts only**: never auto-sends. `invoice recurring generate` + `invoice send <id>` is the loop; auto-sending is a deliberate non-goal (someone might want to review or tweak a recurring invoice before it goes out).
- **`schedule-help` doesn't install** — it prints. Users decide whether to wire up cron themselves. Keeps the "no daemons in our code" property exact.

### What is NOT in Phase 4 (don't accidentally build)

- React Email migration — Phase 4.5.
- Logo embedding — Phase 5.
- Dashboard pages — Phase 5.
- Auto-sending recurring invoices — explicit non-goal.

## Phase 4.6 — Onboarding ergonomics & quick id access

### Context

Two friction points emerged from manual use after Phases 4 + 4.5:

1. **New schema fields aren't onboarded.** `invoice init` still asks only for SMTP/IMAP/recipients. The company/bank/tax/payment/branding/signature/line-item-header fields all exist in the schema, but to populate them users have to read `PLAN.md` and run `invoice config set company.name "..."` for each — one key at a time. There's also no per-invoice prompt for `customerAddress`, even though the renderer shows it.
2. **No quick way to find an invoice id later.** `invoice new` prints the UUID once. `invoice list` doesn't show it. To `invoice send <id>` later, users scroll terminal history or open `local.db`. The UUID is also long (36 chars) and not the mental model users actually have ("send INV-2026-0042").

### Goals

- One-shot onboarding covering every field on the rendered invoice via `invoice init`.
- Per-section re-entry via `invoice setup <section>` for incremental edits.
- `invoice list` shows a short id. `send`/`mark`/`clone` accept full UUID, short id (first 8 chars), or invoice number.

### Step 1 — Refactor init into reusable section helpers

**Files**:

- `packages/cli/src/commands/init.ts` — extract the per-section flows into pure-ish async functions.

**New helpers** (each takes the matching slice of existing config + returns new values; prompts inline; Enter-to-keep current value):

- `setupCompany(existing: Config['company']): Promise<Config['company']>` — name, address (multi-line), phone, website, taxId.
- `setupBank(existing: Config['bank']): Promise<Config['bank']>` — accountName, accountNumber, ifsc, accountType, bankName.
- `setupTax(existing: { defaultTaxRate?, taxLabel?, paymentInstructions? }): Promise<same>` — rate (decimal), label, payment instructions (multi-line).
- `setupBranding(existing: Config['branding']): Promise<Config['branding']>` — primaryColor, fontFamily, signatureUrl, signatoryLabel.
- `setupLineItemHeader(existing: string): Promise<string>` — header text (default "Description").
- `setupMail(existing: Config['mail']): Promise<Config['mail']>` — subjectTemplate, bodyTemplate (multi-line), replyTo. Default subjectTemplate is empty (falls back to built-in `subjectFor`). Hint shows the 6 supported placeholders: `{invoiceNumber}/{customerName}/{total}/{currency}/{issueDate}/{dueDate}`.

Co-located in `init.ts` so both `init` and `setup` can import without circular deps.

### Step 2 — Reorder init + add optional sections

**Files**:

- `packages/cli/src/commands/init.ts` — rework the prompt order.

**New order** (rearranged so the company name is captured before the number-format prompt, which then suggests `{COMPANY3}-...`):

1. **Identity**: name, email, currency.
2. **Company info** (optional section — `Set up company info now? (y/N)`). If yes → `setupCompany(...)`. Captures `company.name` (used in #3).
3. **Invoice number format**: prompt defaults to `{COMPANY3}-{YYYY}-{SEQ}` when `company.name` is set, else falls back to `INV-{YYYY}-{SEQ}`. Help text mentions all placeholders including `{COMPANY3}` from Phase 4.5.
4. **SMTP** (host/port/user/password + live verify).
5. **IMAP** (host/port/user/password + folder picker).
6. **Default recipients** (to/cc/bcc).
7. **Optional sections** — each gated on a `(y/N)` prompt:
   - `Set up bank details now? (y/N)` → `setupBank`
   - `Set up tax & payment defaults now? (y/N)` → `setupTax`
   - `Set up mail (subject line, body, reply-to) now? (y/N)` → `setupMail`
   - `Set up branding & signature now? (y/N)` → `setupBranding`
   - `Set the line-item column header? (y/N)` → `setupLineItemHeader`

Each "y" calls the matching helper; results merge into the final config before save. Re-running init keeps all existing values as defaults.

### Step 3 — `invoice setup <section>` subcommand

**Files**:

- `packages/cli/src/commands/setup.ts` (new):
  - `invoice setup company` → `setupCompany(config.company)` → save.
  - `invoice setup bank` → `setupBank(config.bank)` → save.
  - `invoice setup tax` → `setupTax({...})` → save into `config.invoice`.
  - `invoice setup mail` → `setupMail(config.mail)` → save. (Subject template, body template, replyTo.)
  - `invoice setup branding` → `setupBranding(config.branding)` → save.
  - `invoice setup line-header` → `setupLineItemHeader(config.invoice.lineItemHeader)` → save.
  - `invoice setup number-format` → re-prompts `invoice.numberFormat` with the same `{COMPANY3}-{YYYY}-{SEQ}` default logic as init.
  - `invoice setup all` → runs every section (effectively a re-run of the optional sections of init without re-asking SMTP/IMAP).
- `packages/cli/src/index.ts` — register.

Each subcommand bails if no config exists: `"Run \`invoice init\` first to set up the basics."`

### Step 4 — `customerAddress` prompt in `invoice new`

**Files**:

- `packages/cli/src/commands/new.ts` — after the customer email prompt, before currency:

```
Customer address (multi-line; empty line to finish):
  Line 1: 752 Catania Tower
  Line 2: Mahagun Mascot Society
  Line 3:
```

Sub-loop prompting `Line N:` until an empty input. Lines joined with `\n` and stored in `default.customerAddress`. The renderer already converts `\n` → `<br/>` in the Billed To box.

### Step 5 — Short id column in `invoice list`

**Files**:

- `packages/cli/src/commands/list.ts`:
  - Prepend `Id` column showing `invoice.id.slice(0, 8)`.
  - New flag: `--full-id` (or `--full`) renders the full 36-char UUID.
  - Header reads `Id` or `Id (full)` accordingly.

The full UUID stays in the JSON sidecar and DB; this is purely display.

### Step 6 — Resolver: accept UUID, short id, or invoice number

**Files**:

- `packages/cli/src/resolver.ts` (new):

```ts
export type ResolveResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'ambiguous'; matches: Invoice[] };

export async function resolveInvoice(store: InvoiceStore, ref: string): Promise<ResolveResult>;
```

Resolution order:

1. **Full UUID** match — `store.get(ref)`. If exists, return it.
2. **Short-id prefix** — `inv.id.startsWith(ref)` when `ref.length` is 4–35.
3. **Invoice number exact match** — `String(inv.default.invoiceNumber) === ref`.

Steps 2 and 3 search a single `store.list()` call; their matches are merged and deduped. Single match → `{ ok: true }`. Multiple → `{ ok: false, reason: 'ambiguous', matches }`. None → `{ ok: false, reason: 'not-found' }`.

- `packages/cli/src/commands/send.ts` / `mark.ts` / `clone.ts`:
  - Replace `store.get(id)` with `resolveInvoice(store, id)`.
  - On `ambiguous`: print each match as `{short-id} {number} {customer}` and exit 1 so user can re-run with a more specific reference.

- `packages/cli/src/resolver.test.ts` (new):
  - Full UUID hit, short-prefix hit, invoice-number hit.
  - Not found.
  - Ambiguous: two invoices with the same invoice number after a mid-flight `numberFormat` change.

### Critical files modified

- `packages/cli/src/commands/init.ts` — sections + helpers.
- `packages/cli/src/commands/setup.ts` (new).
- `packages/cli/src/commands/new.ts` — customer address prompt.
- `packages/cli/src/commands/list.ts` — short id column + `--full-id`.
- `packages/cli/src/resolver.ts` (new) + `resolver.test.ts` (new).
- `packages/cli/src/commands/send.ts` / `mark.ts` / `clone.ts` — use resolver.
- `packages/cli/src/index.ts` — register `setup`.

### Verification

Automated:

- `pnpm test` adds ~5–8 tests for the resolver. Expect ~180+ total.
- `pnpm build` + `pnpm lint` clean.

Manual smoke (Phase 4.6 walkthrough in `TESTING.md`):

1. Fresh `INVOICE_HOME`. `invoice init` happy path covering every optional section. After company info, the number-format prompt suggests `{COMPANY3}-{YYYY}-{SEQ}`. `invoice config get company` confirms the fields landed.
2. Re-run `invoice setup bank` and change an IFSC value. `invoice config get bank.ifsc` reflects it.
3. `invoice setup mail` sets a custom `subjectTemplate` with placeholders → next `invoice send <id>` uses it.
4. `invoice new` with a multi-line customer address; verify Billed To shows the lines in the rendered email body.
5. `invoice list` shows a short id column; the first 8 chars match `invoice config get` against the row's UUID.
6. `invoice send <short-id>` works; `invoice send <invoice-number>` works; `invoice send <full-uuid>` still works.
7. Two invoices manually share a number → `invoice send <number>` errors with both matches.

### Out of scope (defer)

- `invoice edit <id>` mutating other fields after creation — separate concern.
- Shell tab-completion for ids/numbers — out-of-band.
- Bulk operations (`invoice send --all-drafts-for <customer>`).

## Phase 4.7 — UX flows (init welcome + drafts, customer directory, subject placeholders, command chaining, productivity adds)

### Context

Five UX improvements from manual use:

1. `invoice init` drops the user in with no overview of what the CLI does or how to get started. Crashes mid-init (SMTP verify fail, Ctrl+C) lose all typed input.
2. The "default recipient email" lives once globally in `config.mail.recipients.to`, but every customer has its own AR / billing email. Users want a **per-customer default** — pick a saved customer in `invoice new` and recipients pre-fill from that customer.
3. Subject templates only know about the invoice's fields. Users want richer placeholders like `Invoice - {userName} - {monthShort}'{yearShort}`.
4. To clone-then-send, users currently run two commands. They'd prefer `invoice clone <id> --send --yes`.
5. Quick-access shortcuts: `invoice last` to print the most recent invoice, `invoice send --last` for "just-made-it-send-it", `invoice new --customer <name>` to skip the picker, `invoice resend <id>` for bounced sends.

### Goals

- New users see a brief feature overview at the top of `invoice init`.
- Partial init state survives crashes via `~/.invoice/init.draft.json`; re-running resumes from the last saved point.
- A **customer directory** (`config.customers`) lets the user store per-customer recipients + addresses; `invoice new` picks from it.
- Subject placeholders include sender identity and date pieces.
- `--send` flag chains clone/template-use/recurring-generate straight into a send.
- Productivity shortcuts: `invoice last`, `invoice send --last`, `invoice new --customer <name>`, `invoice resend <id>`.

### Decisions confirmed

- **Customer storage**: inline in `config.json` as `config.customers: Record<slug, CustomerData>`. Single file, atomic writes, no I/O complexity. Customer data is small (~200 bytes per entry); even 50 customers add ~10 KB to config.
- **Command chaining**: `--send` flag on the generator commands. No custom argv parsing.
- **All four productivity adds in scope** (`invoice last`, `invoice send --last`, `invoice new --customer`, `invoice resend`).

### Step 1 — `invoice init` welcome banner + draft persistence (init AND new)

**Files**:

- `packages/cli/src/commands/init.ts` — add `printWelcome()` helper printing a brief overview at the start.
- `packages/cli/src/drafts.ts` (new) — generic draft I/O parametrized by name. Functions:
  - `loadDraft<T>(name): T | null`
  - `saveDraft(name, partial)` (writes to `~/.invoice/<name>.draft.json`, mode 0600)
  - `clearDraft(name)`
    Used by both init (`name='init'`) and new (`name='new'`).
- Wrap each section in `runInit` with a `saveDraft('init', accumulator)` call after each prompt section so partial state survives a crash.
- On `runInit` entry: if `init.draft.json` exists, prompt `"Resume previous init session? (Y/n)"` — `Y` loads draft and uses values as prompt defaults; `N` deletes draft and starts fresh.
- On `saveConfig` success at the end: `clearDraft('init')`.
- **SMTP/IMAP verify failure**: catch the error, prompt `"Retry with different credentials? (Y/n)"`, re-loop the password (and host/port/user if needed). Don't throw immediately.
- **`invoice new` draft persistence (same pattern)**: `commands/new.ts` saves to `new.draft.json` after each prompt (customer name, email, address, currency, after each line item, etc.). On entry: if a draft exists, prompt `"Resume previous new-invoice session? (Y/n)"`. Draft is cleared on successful `store.upsert`. Catches Ctrl+C in the middle of a long line-item loop.

**Welcome banner content** (short):

```
Invoice generator — Creowis CLI
───────────────────────────────────────────
This tool lets you:
  • Create invoices         (invoice new)
  • Send them via SMTP      (invoice send <id>)
  • Pull received invoices  (invoice sync)
  • Mark paid / overdue     (invoice mark <id> paid)
  • Clone last month's      (invoice clone <id>)

Setup is one-time. Each section can be re-run later via
  invoice setup <section>

Press Ctrl+C at any time — your progress is saved.
───────────────────────────────────────────
```

**Checkpoint**: kill init halfway through SMTP, re-run, see "Resume previous init session?", confirm name/email/currency/numberFormat/company pre-fill from before.

### Step 2 — Customer directory (schema + storage)

**Files**:

- `packages/shared/src/config-schema.ts` — add:
  ```ts
  customers: z.record(z.string(), z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    defaultRecipientTo: z.array(z.string().email()).default([]),
    defaultRecipientCc: z.array(z.string().email()).default([]),
  })).default({}),
  ```
- `packages/cli/src/customers.ts` (new) — slug helper + CRUD over `config.customers`:
  - `slugFor(name): string` — lowercase, hyphenated, alphanumeric-only (same pattern as templates).
  - `listCustomers(config): Array<[slug, CustomerData]>` — sorted by name.
  - `getCustomer(config, ref): CustomerData | null` — accepts slug or name.
  - `setCustomer(config, slug, data): Config` — returns updated config (caller saves).
  - `deleteCustomer(config, slug): Config` — returns updated config.

### Step 3 — `invoice customer save/list/show/delete` subcommands + init/setup integration

**Files**:

- `packages/cli/src/commands/customer.ts` (new):
  - `invoice customer save` — interactive: name → email → address (multi-line) → phone → defaultRecipientTo (CSV) → defaultRecipientCc (CSV). Slug computed from name. Refuses to overwrite an existing customer (use `--force` or `customer delete` first).
  - `invoice customer list` — table: Slug, Name, Email, Default recipients.
  - `invoice customer show <name-or-slug>` — pretty-print JSON.
  - `invoice customer delete <name-or-slug>` — interactive confirm; `--yes` to skip.
- `packages/cli/src/index.ts` — register.

**Three entry points for adding customers** (all reuse the same `setupCustomer` helper):

1. **Direct command**: `invoice customer save` (above).
2. **Init's optional sections**: add `Add customers now? (y/N)` to the optional-setup block in `runInit`. If yes, loops `setupCustomer()` calls until the user says "Done? (y/N)". Suitable for users who know their customer list upfront.
3. **Save-on-send prompt** (Step 6): after a successful `invoice send` to a not-yet-saved customer, ask `Save <Name> as a customer for next time? (Y/n)` — high-signal moment ("I actually billed them"). Walks `setupCustomer(name, defaultRecipientTo: recipients.to, defaultRecipientCc: recipients.cc)` with already-collected values pre-filled.

**Setup helper signature** (in `init.ts`, exported):

```ts
export async function setupCustomer(prefill?: Partial<CustomerData>): Promise<CustomerData>;
```

**Checkpoint**: `invoice customer save` → `invoice customer list` shows it; `invoice config get customers.<slug>` confirms it lives in config.json. Add a customer during init → appears in `customer list`. Send to a new customer → save prompt → confirm → `customer list` shows them.

### Step 4 — Customer picker in `invoice new`

**Files**:

- `packages/cli/src/commands/new.ts`:
  - Before the `customerName` prompt, check `config.customers`.
  - If empty: prompt as today, plus a final question `"Save this customer for future use? (Y/n)"`. If Y, also prompt `defaultRecipientTo` (CSV, defaults to global `config.mail.recipients.to`) + `defaultRecipientCc`, then save into `config.customers`.
  - If non-empty: show a `select` picker — list of saved customers + a `+ New customer` option at the bottom. Picking a saved one pre-fills customerName, customerEmail, customerAddress, and stashes the customer's `defaultRecipientTo`/`defaultRecipientCc` for the `recipients` snapshot. Picking `+ New customer` runs the as-today flow with the optional save-for-future step.
- The `customerData` selected (or just-created) is stashed on `invoice.default.customerSlug` (a new optional default field) so the send step can look it up for recipients.
- `packages/shared/src/invoice.ts` — add `customerSlug` to `DEFAULT_FIELDS`.

**Send-side change** (`commands/send.ts`):

- Before composing recipients, look up the customer's defaults via `getCustomer(config, invoice.default.customerSlug)`:
  - Effective `to` = `--to` flag → customer.defaultRecipientTo → `config.mail.recipients.to`.
  - Effective `cc` = `--cc` flag → customer.defaultRecipientCc → `config.mail.recipients.cc`.
  - Same precedence for `bcc` (customer doesn't have a Bcc field; falls straight from `--bcc` or `config.mail.recipients.bcc`).

**Checkpoint**: pick a saved customer in `invoice new`; `invoice send <id>` shows the customer's default recipients in the confirm screen.

### Step 5 — Expanded subject placeholders

**Files**:

- `packages/shared/src/email-format.ts` — extend `renderSubject(template, invoice)`:
  - Add placeholders derived from invoice fields:
    - `{userName}` ← `invoice.default.fromName`
    - `{userEmail}` ← `invoice.default.fromEmail`
    - `{companyName}` ← `invoice.default.companyName` (sender)
    - `{customerEmail}` ← `invoice.default.customerEmail`
  - Date pieces derived from `invoice.default.issueDate` using `Intl.DateTimeFormat` (locale-stable):
    - `{month}` — full month name ("April")
    - `{monthShort}` — short month name ("Apr")
    - `{monthNum}` — 2-digit ("04")
    - `{year}` — 4-digit ("2026")
    - `{yearShort}` — 2-digit ("26")
    - `{day}` — day-of-month ("28")
    - `{dayPadded}` — 2-digit day ("28")
- Tests in `email-format.test.ts`: each new placeholder + a mixed template like `Invoice - {userName} - {monthShort}'{yearShort}` rendering correctly.

### Step 6 — `--send` flag on clone / template use / recurring generate

**Files**:

- `packages/cli/src/commands/send.ts` — extract `sendInvoiceById(id, sendOpts)` (or similar) so other commands can reuse the full send pipeline (resolve → confirm → SMTP → upsert).
- `packages/cli/src/commands/clone.ts` — add `--send` (boolean) and `--yes` to the option surface. After the upsert succeeds, if `--send`, call into the extracted send function with the new id. `--yes` flows through.
- `packages/cli/src/commands/template.ts` — same for `template use`.
- `packages/cli/src/commands/recurring.ts` — `recurring generate` gets `--send` too. When set, after each draft is created, immediately send it (respecting `--yes`). One ambiguous case: if `recurring generate` produces N drafts and `--send` is set, do we confirm per send or send all in one go? **Decision**: per-send confirmation by default (one prompt per draft); `--yes` skips them all.

### Step 7 — Productivity shortcuts

**Files**:

- `packages/cli/src/commands/last.ts` (new) — `invoice last`:
  - Loads the most-recently-created invoice (sorted by `createdAt` or, fallback, by `issueDate DESC`). Prints short id, full UUID, invoice number, customer, status, total. Single block, easy to grep.
  - **`--drafts` flag** restricts to `status='draft'` only. Useful for the "send what I just made" mental model.
- `packages/cli/src/commands/send.ts` — add `--last` flag. When set, ignore the positional `<id>` arg (or make it optional) and resolve to the most recent **draft** (filter `status='draft'`, sort by createdAt DESC). Errors if no drafts exist.
- `packages/cli/src/commands/new.ts` — add `--customer <name-or-slug>` flag. When set, look up via `getCustomer`; bail if not found; skip the picker entirely.
- `packages/cli/src/commands/resend.ts` (new) — `invoice resend <id>`:
  - Resolves the invoice via the resolver.
  - Warns: `"Invoice was already sent at <sentAt> to <recipients>. Resend? (y/N)"` (with `--yes` to skip).
  - Sends again (re-using the same orchestrator from Step 6).
  - Updates `sentAt` to the new timestamp; `recipients` reflects the actual `--to/--cc/--bcc` overrides (or customer defaults).
- `packages/cli/src/commands/search.ts` (new) — `invoice search <text>` thin wrapper around `invoice list --text <text>`.
- `packages/cli/src/index.ts` — register `last`, `resend`, `search`. Also register `ls` as an alias for `list` via commander's `.alias('ls')`.

### Step 8 — Verification + housekeeping

**Run**:

- `pnpm build && pnpm test && pnpm lint` clean. Expect ~210+ tests (additions: customer storage CRUD, subject placeholders, send orchestrator unit if extracted, resend logic).
- Walk a new "Phase 4.7 verification" section in `TESTING.md`:
  - Init welcome banner appears.
  - Ctrl+C during init mid-section, re-run, draft prompt appears, values pre-filled.
  - SMTP retry loop works.
  - `invoice customer save / list / show / delete` round-trips through config.json.
  - `invoice new` picker shows saved customers; "+ New customer" path optionally saves.
  - Send composes recipients with customer-first precedence.
  - Subject template `Invoice - {userName} - {monthShort}'{yearShort}` renders correctly.
  - `invoice clone <id> --send --yes` chains.
  - `invoice last`, `invoice send --last`, `invoice new --customer Acme`, `invoice resend <id>` all behave as designed.

**Update**:

- `CLAUDE.md` — bump phase status to include 4.7; record deviations (customer directory in config.json, send orchestrator extraction, recurring generate's per-draft confirm behavior, etc.).

### Critical files to create

- `packages/cli/src/drafts.ts` (generic init + new draft persistence)
- `packages/cli/src/customers.ts`
- `packages/cli/src/commands/customer.ts`
- `packages/cli/src/commands/last.ts`
- `packages/cli/src/commands/resend.ts`
- `packages/cli/src/commands/search.ts`

### Critical files to modify

- `packages/shared/src/config-schema.ts` (add `customers` map)
- `packages/shared/src/invoice.ts` (`customerSlug` in DEFAULT_FIELDS)
- `packages/shared/src/email-format.ts` (`renderSubject` placeholders)
- `packages/cli/src/commands/init.ts` (welcome + draft persistence + SMTP/IMAP retry loop)
- `packages/cli/src/commands/new.ts` (picker + `--customer` flag + save-customer follow-up)
- `packages/cli/src/commands/send.ts` (customer-aware recipient composition + extract orchestrator + `--last` flag)
- `packages/cli/src/commands/clone.ts` (`--send`/`--yes`)
- `packages/cli/src/commands/template.ts` (`--send`/`--yes` on `use`)
- `packages/cli/src/commands/recurring.ts` (`--send`/`--yes` on `generate`)
- `packages/cli/src/index.ts` (register new commands)

### Out of scope (defer to later phases)

- Multi-sender-company support (a user works for multiple sender entities). Probably never; if needed, becomes a flat additive change since `config.company` becomes `config.companies` keyed by something.
- Customer-side analytics (top customers by invoice volume, etc.) — Phase 6 (`/analytics`).
- Importing customers from CSV — niche; defer.
- Tab completion for customer names — Phase 3 polish.

## Out of scope (explicit non-goals)

- Any hosted/cloud component beyond the mail provider itself.
- PDF generation anywhere in the pipeline.
- Background sync, daemons, timers.
- Multi-tenant architecture — each install is self-contained.
- Encryption at rest of `local.db` — relies on filesystem permissions.
- Customer portal, payment links, complex tax calculation.
- Localization beyond `cli.locale` formatting.
