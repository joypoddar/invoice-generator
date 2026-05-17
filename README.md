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

## Status

**Phase 1 (CLI MVP) — in development.** See [`PLAN.md`](./PLAN.md) for the full design and roadmap (9 phases, including a future local-LLM chat phase).

## Repository layout

| Path | Purpose |
|---|---|
| [`PLAN.md`](./PLAN.md) | Full design — architecture, decisions, all phases. The source of truth. |
| [`CLAUDE.md`](./CLAUDE.md) | Guidance for AI-assisted development sessions. |
| `packages/shared/` | `Invoice` type, email-format constants, Zod config schema. |
| `packages/core/` | `InvoiceStore` + storage, IMAP wrapper, ingestion, queries, CSV. |
| `packages/cli/` | The `invoice` binary (single command, no role gating). |
| `packages/dashboard/` | Hono server + server-rendered JSX views. |

## Roadmap

1. **Phase 1** — CLI MVP: `init` / `new` / `send` (with confirmation) / `sync` / `list`.
2. **Phase 2** — CLI productivity: filter/sort, `mark`, `export csv`, `preview`.
3. **Phase 3** — Polish + isolation tests.
4. **Phase 4** — HTML invoice rendering polish (the email body and dashboard print view).
5. **Phase 5** — Hono dashboard MVP (read-only + Sync now + paid toggle).
6. **Phase 6** — Dashboard analytics + CSV export.
7. **Phase 7** — Git-backed storage of `~/.invoice/data/` (opt-in).
8. **Phase 8** *(optional, future)* — Hosted DB migration via `InvoiceStore`.
9. **Phase 9** *(optional, future)* — Local LLM (`invoice chat`) with tool-calling.

## Tech stack

- Node.js 20 + TypeScript (strict).
- `commander` + `@inquirer/prompts` (CLI).
- `nodemailer` (SMTP), `imapflow` + `mailparser` (IMAP).
- `better-sqlite3` (local DB).
- `@napi-rs/keyring` (passwords in OS keychain).
- Hono + Hono JSX (dashboard server, no bundler).
