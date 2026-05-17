# CLAUDE.md

Project-level guidance for future Claude Code sessions in this repo.

## What this is

An invoice generator for a small team (5–20 people) at Creowis. Every team member runs the same `invoice` CLI on their laptop — **there is no admin/user role split in the codebase**. What you see is determined by `imap.folder` in your config:

- A regular team member sets `imap.folder = "Sent"` (their own provider's Sent folder) → sees only what they sent.
- The person who manages `hello@creowis.com` (call them the "inbox manager" — domain term, not a role) sets `imap.folder = "INBOX"` against that mailbox → sees every invoice the team has emailed in.

Email is the canonical pipeline. The local SQLite is a derived index, rebuildable any time with `invoice sync --backfill`. **No hosted infrastructure, no OAuth, no SaaS, no daemons, no background polling.**

The full design is in [`PLAN.md`](./PLAN.md). **Read it before starting work** — it documents not just what to build but why each trade-off was chosen.

## Architectural decisions that shape every change

These are non-obvious from reading the code. Internalize them.

1. **No role separation in the codebase.** No `auth.ts`, no `roles()`, no `invoice admin` namespace. Anywhere you're tempted to write "if admin," stop — the answer is folder configuration, not code. The word *admin* should not appear as a CLI role designator.
2. **Email is the source of truth.** SQLite is derived. If `local.db` is lost, `invoice sync --backfill` rebuilds it from the mail provider.
3. **Manual sync only.** No timers, no daemons, no background jobs. The user clicks "Sync now" or runs `invoice sync`.
4. **`InvoiceStore` interface (`packages/core/src/store.ts`) is the migration boundary.** All filtering, aggregation, CSV export, and dashboard pages go through it. **Never write SQL outside `core/sqlite-store.ts`.** A future hosted-DB migration adds one new file (`postgres-store.ts`) and flips `storage.backend` in config; nothing else changes.
5. **One sync function.** `core/ingest.ts` is called identically from `invoice sync` (CLI) and `POST /sync` (Hono). Behavior cannot drift.
6. **No PDF anywhere in the pipeline.** Eliminated from send path, eliminated from the schema (`pdf_blob` does not exist), eliminated as a dependency. The HTML invoice rendered in the dashboard is the customer-facing artifact; "Print" uses `window.print()`.
7. **Single email attachment**: `invoice-<number>.json`. The JSON sidecar is the dashboard-readable contract. **`X-Invoice-Generator: 1` header** is what `invoice sync` filters on.
8. **Secrets in OS keychain via `@napi-rs/keyring`** (replaces archived `keytar`). Service `invoice-cli`; accounts `smtp-app-password` and `imap-app-password`. Never put secrets in `config.json`.
9. **Send confirms by default.** `invoice send <id>` shows recipient + body summary and asks `Send? [y/N]`. `--yes` skips. `--to/--cc/--bcc` override the recipe for that send only.
10. **Invoice number is display-only; UUID is the real key.** Number format is configurable (`{SEQ}/{YYYY}/{MM}/{DD}`) and changeable mid-flight. Old invoices keep their old number; collisions are harmless because UUID is the primary key.
11. **Dashboard binds to `127.0.0.1` only.** Hono server, server-rendered JSX, vanilla `fetch` for the two interactive widgets (sync, paid toggle). **No Next.js, no NextAuth, no React on the client, no bundler, no build step.**

## Project layout (target)

```
invoice-generator/
├── PLAN.md              # full design — the source of truth
├── CLAUDE.md            # this file
├── README.md
├── package.json         # workspaces root (Phase 1)
├── tsconfig.base.json   # strict: true (Phase 1)
└── packages/
    ├── shared/          # Invoice type, email-format constants, Zod config schema
    ├── core/            # InvoiceStore + sqlite-store, imap, ingest, queries, csv, git
    ├── cli/             # `invoice` command — single binary, no admin namespace
    └── dashboard/       # Hono server with JSX views (no Next.js)
```

## Phase status

The plan lays out 9 phases. The repo currently has only docs — no code. **Active phase: Phase 1 (CLI MVP)** — see `PLAN.md` § "Execution phases" for the precise scope.

When you complete a phase, update this section so the next session knows where things stand.

## Conventions

- **TypeScript strict mode from day one.** No `any` outside justified narrow places.
- **No comments by default.** Only add a comment if the *why* is non-obvious — a hidden constraint, a deliberate workaround, or behavior that would surprise a reader. Don't explain *what* the code does; named identifiers do that.
- **No files outside what the plan calls for.** Don't add abstractions, "future-proofing," or scaffolding the plan didn't authorize.
- **Tests live next to source** (`*.test.ts` siblings). Highest-leverage targets: `core/ingest` (sidecar parsing), `core/queries` (filter/sort/aggregate against an in-memory `InvoiceStore`), the IMAP folder picker.
- **Commit small, descriptive units.** When `git.autoCommit` lands (Phase 7), messages follow `{action}: {invoiceNumber}` (`add: CREOWIS-2026-AK-0042`, `update: paid status on ...`).

## Commands (will exist after the corresponding phase)

```bash
# Setup
npm install                          # install workspace deps
npm run build                        # build all packages
cd packages/cli && npm link          # put `invoice` on PATH

# CLI (Phase 1)
invoice init                         # interactive setup; folder picker via imap.list()
invoice new                          # create an invoice
invoice list                         # list local DB
invoice send <id>                    # confirm-then-send (--yes to skip; --to/--cc/--bcc to override)
invoice sync                         # pull from imap.folder into local.db

# CLI (Phase 2)
invoice list --overdue               # filter
invoice mark <id> paid|unpaid
invoice export csv --paid --out paid.csv
invoice preview <id>

# CLI (Phase 5)
invoice dashboard                    # spawn Hono on 127.0.0.1:3000

# CLI (Phase 7)
invoice repo init --remote git@github.com:user/my-invoices.git

# Dev loop
npm run dev                          # workspace watch mode (when configured)
npm test                             # run unit tests
```

## When you're stuck

- The plan answers most "why" questions. Re-read the relevant section before guessing.
- If a requirement seems to contradict the plan, **ask the user** — don't drift. The plan represents agreed-upon constraints.
- Folder-based isolation is a **security property**. If something would let an install read a folder it isn't configured for, stop and flag it.
- If you find yourself wanting to add `if (isAdmin)` or anything role-shaped, you're going the wrong way. There is no admin role.
