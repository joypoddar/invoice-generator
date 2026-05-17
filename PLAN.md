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

| Concern | How it's addressed |
|---|---|
| No hosting bill | Everything runs on the user's laptop. Mail provider is whatever the team already pays for. |
| No ops | Nothing to keep alive. Manual sync only — no daemons, no timers. |
| Minimal backend code | One Hono server, a handful of routes, server-rendered JSX. No bundler, no build step. |
| Self-contained | Once synced, the dashboard works fully offline. |
| Real query/filter/sort | SQLite + `better-sqlite3` + the `core/queries.ts` module. |
| Recent + backfill ingestion | `invoice sync` (incremental, watermarked by IMAP UID) and `--backfill` / `--since` (historical). |
| Paid/unpaid + overdue | `payment_status` column + a query-time overdue predicate. Toggleable from CLI or dashboard. |
| Aggregates | SQL `GROUP BY` queries powering `/analytics`. |
| CSV export | Streamed from SQLite via `core/csv.ts`; same code from CLI and dashboard. |
| Users see only their own | Their `imap.folder` is set to their own Sent folder; that's the only thing their CLI ever reads. |
| Team-wide view | The inbox manager's `imap.folder = INBOX` against the shared mailbox. |
| Highlight extra fields | `Invoice.custom` map; row badge when non-empty. |

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
  'invoiceNumber',  // user-defined display format from invoice.numberFormat config
  'issueDate',
  'dueDate',
  'fromName', 'fromEmail',   // sender — typed at init, embedded in every invoice
  'customerName', 'customerEmail',
  'lineItems',               // [{ description, quantity, unitPrice }]
  'currency',                // ISO 4217
  'notes',
] as const;

export interface Invoice {
  id: string;                          // UUID — system-generated. The real key everywhere.
  default: Record<string, unknown>;    // values for DEFAULT_FIELDS
  custom: Record<string, unknown>;     // anything else
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

| Command | Behavior |
|---|---|
| `invoice init` | Interactive setup. Prompts for `name`, `email`, currency, invoice number format, SMTP host/port/user/app-password, IMAP host/port/user/app-password. **Lists IMAP folders via `imapflow.list()` and asks the user to pick** (regular team members pick their Sent folder; the inbox manager picks INBOX of the shared mailbox). Creates `~/.invoice/local.db`. Re-running is idempotent. |
| `invoice config get/set/unset/edit/validate/doctor` | All config operations. `doctor` walks every required key + checks keychain entries. |
| `invoice whoami` | Prints `name`, `email`, configured `imap.folder`, and which mail account the IMAP creds belong to. |
| `invoice new` | Interactive walkthrough of default fields, then `Add additional fields? (y/N)` loop. Saves draft via `SqliteStore.upsert`. |
| `invoice list [--filter ...]` | Filter flags: `--paid / --unpaid / --overdue / --has-custom / --customer / --since / --due-before / --due-after / --sort <field>`. Same `core/queries.ts` powers it. |
| `invoice preview <id>` | Pretty-prints the JSON to stdout AND opens the dashboard's invoice detail page (`http://127.0.0.1:3000/invoices/<id>`) in the default browser. If the dashboard isn't running, prints a hint. |
| `invoice send <id> [flags]` | **Interactive recipient confirmation by default.** Renders to/cc/bcc from `email.recipients` recipe + the per-invoice line items, shows the user a summary, asks "Send? [y/N]". Flags: `--to <email>`, `--cc <email>`, `--bcc <email>` (override recipients for this send only); `--yes` (skip the confirmation prompt). Email contains an HTML body and a single attachment: `invoice-<number>.json`. **No PDF.** |
| `invoice sync [--backfill] [--since <date>]` | Pulls new messages from `imap.folder` matching `X-Invoice-Generator:1`, parses sidecars, upserts into the DB. Manual only — no timers, no daemons. |
| `invoice mark <id> paid \| unpaid` | Updates `payment_status` and `paid_at`. |
| `invoice export csv [--filter ...] [--out file.csv]` | Streams CSV (stdout by default). Same filter grammar as `invoice list`. |
| `invoice dashboard [--port 3000]` | Spawns the Hono server bound to `127.0.0.1`, opens the browser. Server runs in foreground; Ctrl+C stops it. |

### Phase 7 (opt-in): git-backed storage of `~/.invoice/data/`

`~/.invoice/data/` (a separate folder containing JSON snapshots of every invoice) can become a git repo. The mail provider remains the canonical source — git is a secondary mirror for users who want extra durability or audit trail. We never touch the GitHub API; `git push` uses whatever credentials the user's git already has.

| Command | Behavior |
|---|---|
| `invoice repo init [--remote <url>]` | `git init` in `~/.invoice/data/`, initial commit. Asks `Auto-commit on every change? (y/N)` and `Auto-push after each commit? (y/N)`; answers go to `git.autoCommit` / `git.autoPush`. |
| `invoice repo status / commit [-m <msg>] / push / log` | Manual operations. |

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

| Account | Stored | Used by |
|---|---|---|
| `smtp-app-password` | SMTP app password | `invoice send` |
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
  dueBefore?: string; dueAfter?: string;
  paymentStatus?: 'paid' | 'unpaid';
  overdue?: boolean;
  hasCustomFields?: boolean;
  fromEmail?: string;
  customerName?: string;
}
```

All filtering, aggregation, CSV export, and dashboard pages take an `InvoiceStore` and a typed filter/aggregate spec. **No SQL or filesystem APIs anywhere outside `core/sqlite-store.ts`.**

This is the explicit migration boundary. Today's only impl is `SqliteStore`. A future migration to a hosted DB (Fly.io + Postgres, Supabase, etc.) is a *new file added* (`postgres-store.ts`), not a codebase rewrite. The other half of the migration is config-driven: `storage.backend = 'postgres'` and `storage.connectionUrl = '...'` switches the runtime store. No code path changes.

## Configuration

A single `~/.invoice/config.json`. Validated by a Zod schema in `packages/shared/src/config-schema.ts` — single source of truth for runtime validation and TypeScript types. **Override order, highest wins**: CLI flag → env var (`INVOICE_*`) → `config.json` → built-in default. **Secrets never go here.**

| Key | Purpose | Phase |
|---|---|---|
| **Identity** |
| `name`, `email` | Sender identity | 1 |
| `company.name`, `company.address`, `company.phone`, `company.website`, `company.taxId` | Printed on the HTML invoice + From header | 4 (HTML invoice design) |
| `branding.primaryColor`, `branding.fontFamily`, `branding.logoUrl` | Visual design of the HTML invoice | 4 |
| **Invoice defaults** |
| `currency` | Default currency code | 1 |
| `invoice.numberFormat` (string with `{SEQ}/{YYYY}/{MM}/{DD}`), `invoice.nextSeq` (integer) | Display-format generation | 1 |
| `invoice.defaultDueDays` | `dueDate = issueDate + N` | 1 |
| `invoice.defaultTaxRate`, `invoice.taxLabel` | Tax line | 4 |
| `invoice.defaultNotes`, `invoice.paymentInstructions`, `invoice.dateFormat`, `invoice.currencyFormat` | HTML invoice content + formatting | 4 |
| **Email recipients (recipe)** |
| `email.recipients.to: string[]` | Default `to` list (e.g. `["hello@creowis.com"]`) | 1 |
| `email.recipients.cc: string[]`, `email.recipients.bcc: string[]` | Default cc/bcc | 1 |
| `email.subjectTemplate`, `email.bodyTemplate` | Customizable subject/body | 5 |
| `email.replyTo` | Reply-to header | 5 |
| **SMTP** |
| `smtp.host`, `smtp.port`, `smtp.user` | Connection (password in keychain) | 1 |
| **IMAP / sync** |
| `imap.host`, `imap.port`, `imap.user` | Connection (password in keychain) | 1 |
| `imap.folder` | **Folder to sync from. The only thing that scopes what you see.** | 1 |
| `sync.maxBackfillMonths` | Cap on `--backfill` | 2 |
| **Storage / migration** |
| `storage.backend` (`sqlite` in v1) | Active store implementation | 1 |
| `storage.dbPath` | Override `~/.invoice/local.db` | 3 |
| **Dashboard** |
| `dashboard.port`, `dashboard.host` | Bind address (default `127.0.0.1:3000`) | 5 |
| `dashboard.theme`, `dashboard.defaultSort`, `dashboard.defaultFilter` | UI prefs | 5/6 |
| **Git** |
| `git.enabled`, `git.remote`, `git.autoCommit`, `git.autoPush`, `git.commitMessageTemplate`, `git.pushRetries` | Phase-7 git-backed storage | 7 |
| **CLI behavior** |
| `cli.editor`, `cli.confirmBeforeSend` (default `true`), `cli.openPdfAfterPreview` | UX knobs (`--yes` flag overrides `confirmBeforeSend`) | 3 |
| `cli.locale`, `cli.logLevel` | Misc | 3 |
| **LLM (deferred to Phase 9)** |
| `llm.provider` (`ollama`/`lmstudio`/`openai-compatible`/`disabled`), `llm.endpoint`, `llm.model`, `llm.temperature`, `llm.maxTokens`, `llm.systemPromptOverride`, `llm.features.*` | Future chat | 9 |

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
19. **Folder-scoping test**: in a second `HOME`, `invoice init` again with the same Gmail but `imap.folder = INBOX`. `invoice sync` → finds the email there too (since you sent it to `hello@creowis.com`, but here, from the same Gmail, INBOX won't have it — replace with a real second mailbox to verify). The point: this install only sees what's in *its* folder.
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

### Phase 4 — HTML invoice rendering polish

**Goal**: the HTML invoice (used both as email body and dashboard print view) looks professional.

**Build**:
- Real branding: logo, color, typography from `branding.*` config.
- Line-item table, tax line, totals, payment instructions block.
- Proven across line-item lengths (0, few, many → page break in `window.print()`).

**Note**: this replaces the v1 plan's "final PDF design" phase. The HTML invoice is the customer-facing rendering. React Email is the documented upgrade path if the HTML body needs cross-client polish for external customers.

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
- `packages/cli/src/index.ts` — commander entry. Registers every Phase-1 command as a *stub* that prints `not yet implemented`. Shebang `#!/usr/bin/env node`.
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

## Out of scope (explicit non-goals)

- Any hosted/cloud component beyond the mail provider itself.
- PDF generation anywhere in the pipeline.
- Background sync, daemons, timers.
- Multi-tenant architecture — each install is self-contained.
- Encryption at rest of `local.db` — relies on filesystem permissions.
- Customer portal, payment links, complex tax calculation.
- Localization beyond `cli.locale` formatting.
