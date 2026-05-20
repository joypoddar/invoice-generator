# Invoice Generator

A CLI-first invoice tool for the Creowis team. Every team member runs the same `invoice` CLI on their laptop. There's no role split — what you see is determined by which IMAP folder you point at:

- **Regular team member**: point at your own provider's Sent folder → see only what you've sent.
- **Inbox manager** (whoever owns `hello@creowis.com`): point at INBOX of that mailbox → see every invoice the team has emailed in.

**No hosted servers, no OAuth, no monthly bill, no daemons.** Just SMTP for sending and IMAP for reading — both with app passwords from your existing mail provider.

## How it works

```
   Each team member's laptop:
   ┌────────────────────────────────────────┐
   │  invoice CLI  +  Hono dashboard        │
   │       reads/writes via InvoiceStore    │
   │                  ▼                     │
   │     ~/.invoice/local.db (SQLite)       │
   └────────────────────────────────────────┘
                ▲          │
       IMAP     │          │ SMTP
       (manual sync)       │ (per-user creds)
                │          ▼
   ┌────────────────────────────────────────┐
   │ Mail provider — the canonical store    │
   └────────────────────────────────────────┘
```

- **Invoice creation**: `invoice new` saves to local SQLite.
- **Sending**: `invoice send <id>` shows recipient + body confirm, then sends via SMTP. Email contains an HTML body (the customer-facing invoice) and a single JSON sidecar attachment.
- **Sync**: `invoice sync` pulls from your `imap.folder` into local SQLite. Manual only.
- **Dashboard**: `invoice dashboard` spawns a Hono server on `127.0.0.1:3000`. Server-rendered HTML, no React, no bundler.
- **Backup**: the mail provider preserves every invoice email forever. Lose `local.db` and `invoice sync --backfill` rebuilds it.

## Quick start (after Phase 1)

```bash
npm install
npm run build
cd packages/cli && npm link

invoice init          # interactive: name, email, SMTP + IMAP creds, folder picker
invoice new           # create an invoice
invoice send <id>     # confirm recipients, then send
invoice sync          # pull your sent invoice back into local.db
invoice list          # show local DB
```

## Setup recipes

Three common shapes for `invoice init`. They all share the same binary — what differs is whether SMTP is set up and which IMAP folder you point at.

### 1. Sender (default)

You bill customers, send invoices, and want them indexed locally.

```bash
invoice init
#   Set up sending (SMTP)? → Y
#   Number format / SMTP creds / IMAP creds
#   Folder picker → pick your provider's Sent folder (e.g. "[Gmail]/Sent Mail")
```

What you get: `invoice new` / `send` / `sync` / `list` / `mark paid` / `clone` / `template` / `recurring`. After each `invoice send`, your own Sent folder is the source of truth — re-syncing rebuilds `local.db` from it.

### 2. Account head / inbox manager (receive-only)

You process invoices that _others_ send. You never send anything yourself.

```bash
invoice init
#   Set up sending (SMTP)? → N
#   IMAP creds (for the shared mailbox, e.g. hello@creowis.com)
#   Folder picker → pick INBOX
```

What you get: `invoice sync` (pulls invoices the team received), `invoice list` / `ls` / `search` / `last`, `invoice mark <id> paid|unpaid`, `invoice config doctor`, `invoice whoami`. SMTP-dependent commands (`send`, `resend`, `clone --send`, etc.) print a friendly _"Sending isn't configured. Run `invoice setup smtp` to enable sending."_ and exit.

Promote to a sender later without re-initing:

```bash
invoice setup smtp        # adds host/port/user + keychain password
invoice setup recipients  # adds default 'to' list
invoice setup mail        # optional: subject/body/reply-to templates
```

### 3. Dual role (one person, both hats)

If you sometimes send your own invoices AND sometimes process the shared inbox, run two installs side-by-side using `INVOICE_HOME`:

```bash
# Sender hat — default ~/.invoice/
invoice init                           # answer Y, folder = your Sent
invoice send <id>

# Account-head hat — a second config dir
export INVOICE_HOME=~/.invoice-account-head/
invoice init                           # answer N, folder = shared INBOX
invoice sync && invoice list

# Toggle hats by prefixing the command:
INVOICE_HOME=~/.invoice-account-head/ invoice list
INVOICE_HOME=~/.invoice-account-head/ invoice mark <id> paid
```

Each config dir gets its own `local.db`, keychain entries (different `imap-app-password` per `INVOICE_HOME`), and folder scope. The audit boundary stays clean: `~/.invoice/` only knows about your Sent, `~/.invoice-account-head/` only knows about the shared INBOX.

## Status

**Phase 1 (CLI MVP) — in development.** See [`PLAN.md`](./PLAN.md) for the full design and roadmap (9 phases, including a future local-LLM chat phase).

## Repository layout

| Path                       | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| [`PLAN.md`](./PLAN.md)     | Full design — architecture, decisions, all phases. The source of truth. |
| [`CLAUDE.md`](./CLAUDE.md) | Guidance for AI-assisted development sessions.                          |
| `packages/shared/`         | `Invoice` type, email-format constants, Zod config schema.              |
| `packages/core/`           | `InvoiceStore` + storage, IMAP wrapper, ingestion, queries, CSV.        |
| `packages/cli/`            | The `invoice` binary (single command, no role gating).                  |
| `packages/dashboard/`      | Hono server + server-rendered JSX views.                                |

## Roadmap

1. **Phase 1** — CLI MVP: `init` / `new` / `send` (with confirmation) / `sync` / `list`.
2. **Phase 2** — CLI productivity: filter/sort, `mark`, `export csv`, `preview`.
3. **Phase 3** — Polish + isolation tests.
4. **Phase 4** — HTML invoice rendering polish (the email body and dashboard print view).
5. **Phase 5** — Hono dashboard MVP (read-only + Sync now + paid toggle).
6. **Phase 6** — Dashboard analytics + CSV export.
7. **Phase 7** — Git-backed storage of `~/.invoice/data/` (opt-in).
8. **Phase 8** _(optional, future)_ — Hosted DB migration via `InvoiceStore`.
9. **Phase 9** _(optional, future)_ — Local LLM (`invoice chat`) with tool-calling.

## Tech stack

- Node.js 20 + TypeScript (strict).
- `commander` + `@inquirer/prompts` (CLI).
- `nodemailer` (SMTP), `imapflow` + `mailparser` (IMAP).
- `better-sqlite3` (local DB).
- `@napi-rs/keyring` (passwords in OS keychain).
- Hono + Hono JSX (dashboard server, no bundler).
