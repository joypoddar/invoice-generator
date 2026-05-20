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

1. **No role separation in the codebase.** No `auth.ts`, no `roles()`, no `invoice admin` namespace. Anywhere you're tempted to write "if admin," stop — the answer is folder configuration, not code. The word _admin_ should not appear as a CLI role designator.
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

The plan lays out 9 phases plus mid-phase polishes. **Phases 1, 4, 4.5, 4.6, and 4.7 are complete** — the `invoice` binary ships:

- **Phase 1 (CLI MVP)** — `init / config / whoami / new / list / send / sync / mark`.
- **Phase 4 (Customer-facing invoice + recurring billing)** — branding-driven HTML rendering, `Intl`-based date/currency formatting, print CSS, customizable subject line, `invoice clone`, `invoice template (save/list/use/delete)`, `invoice recurring (create/list/show/delete/generate/schedule-help)`.
- **Phase 4.5 (PDF design parity)** — 6-column line-item table with per-line IGST, signature block (opt-in image embedding), MMM DD YYYY + ISO8601 + DD MMM YYYY date formats, `{COMPANY3}` template variable, configurable line-item header.
- **Phase 4.6 (Onboarding ergonomics + quick id access)** — `invoice init` extended with optional sections, `invoice setup <section>` for incremental edits, customer-address prompt in `invoice new`, short id column in `invoice list`, resolver accepting UUID / short prefix / invoice number for `send / mark / clone`.
- **Phase 4.7 (UX flows)** — init welcome banner + Ctrl+C-safe draft persistence (also wired into `invoice new`), SMTP/IMAP retry loops on verify failure, customer directory at `config.customers` with `invoice customer save/list/show/delete`, picker in `invoice new`, `--customer` flag, customer-aware recipient composition (`composeRecipients(config, invoice, opts)`), 17-placeholder subject templates (sender identity + date pieces), `--send` chaining on clone / template-use / recurring-generate, save-on-send prompt, and productivity shortcuts (`invoice last [--drafts]`, `invoice send --last`, `invoice resend`, `invoice search`, `invoice ls` alias).

**227 unit tests** pass across `shared`, `core`, and `cli`. Manual end-to-end verification (`TESTING.md` § "Phase 4 verification" + "Phase 4.6 verification" + "Phase 4.7 verification") is the remaining item before Phase 5 starts in earnest.

**Active phase: Phase 5 (Hono dashboard MVP)** — local server bound to `127.0.0.1`, server-rendered JSX, vanilla-JS sync/paid-toggle, no Next.js, no bundler. See PLAN.md § "Execution phases" → Phase 5 for the precise scope. **Phase 2 (CLI productivity — filter flags, CSV export, preview)** is still open and can land in parallel.

### Phase-1 deviations (already in code; flag if you change them)

- **`node:sqlite` instead of `better-sqlite3`** — the Linux box this runs on has no C compiler and Node 24 has no published better-sqlite3 prebuilds. `node:sqlite` is built into Node 22+. Tests cover the seam.
- **`mail.*` instead of `email.*`** for the email-send config namespace — the plan implicitly conflated the top-level `email` (user's address, a string) with `email.recipients` (an object). They are now distinct: `email` is the string identity, `mail.recipients.{to,cc,bcc}` is the recipe.
- **`message_uid` nullable** in the SQLite schema (plan had it `UNIQUE NOT NULL`). Drafts created via `invoice new` exist before any IMAP UID is assigned; `NOT NULL` would block that. Still `UNIQUE` to dedupe across syncs, and the upsert `COALESCE`s the column so once set it's preserved.
- **`local.db` is created at default umask `0644`**, not `0600`. The parent dir is `0700` so this isn't reachable by other local users; Phase 3 polish should chmod the DB file after creation.
- **Shebang trick for the SQLite experimental warning** — `#!/usr/bin/env -S node --no-warnings=ExperimentalWarning`. Works when the bin is invoked via the shebang (e.g. after `pnpm link`); explicit `node dist/index.js` invocations still show the warning since they bypass the shebang.

### Phase-3.5 fixes (mid-Phase-4 bug triage)

- **Sidecar status drift fixed.** `send.ts` now builds the `sentInvoice` (status=`sent`, sentAt=now, recipients=…) BEFORE calling `sendInvoice`, so the JSON attached to the email matches what we write locally. Re-sync no longer overwrites the locally-marked-sent row with the original draft state.
- **Sync count semantics.** `ingest()` now returns `{ fetchedCount, newCount, newLastUid }` and reports both: `"Processed 1 invoice(s) (0 new, 1 re-ingested). Watermark: uid 223."`. The "0 new" is now meaningful.
- **`invoice new` prints the id upfront** so it's visible after a long line-item loop.

### Phase-4 deviations (already in code; flag if you change them)

- **`DEFAULT_FIELDS` expanded from 10 → 25 entries** to include company snapshot (`companyName/Address/Phone/Website/TaxId`), customer extras (`customerAddress`), bank snapshot (`bankAccountName/Number/Ifsc/Type/Name`), tax (`taxRate/Label/Amount`), and `paymentInstructions`. `invoice new` silently snapshots these from `config.company.*`, `config.bank.*`, `config.invoice.{defaultTaxRate, taxLabel, paymentInstructions}` at creation time. Renderer reads `invoice.default.X` first, falls back to `invoice.custom.X` (legacy keys: `fromPhone` → `companyPhone`).
- **`config.bank.*` added** to the Zod schema — `{ accountName, accountNumber, ifsc, accountType, bankName }`, all optional.
- **Pure transforms (`prepareClone`, `templateFromInvoice`, `materializeFromTemplate`) moved from `cli/` into `core/src/recurring.ts`** so both the CLI clone/template commands and the recurring engine share them. CLI files re-export for compat.
- **Recurring storage methods live on `SqliteStore`, not on `InvoiceStore` interface** — same pattern as `getLastUid/setLastUid`. If a `PostgresStore` ships in Phase 8, it'll add the same methods at the impl level.
- **`mail.subjectTemplate` promoted from Phase 5 to Phase 4** with six placeholders: `{invoiceNumber}`, `{customerName}`, `{total}`, `{currency}`, `{issueDate}`, `{dueDate}`. `invoice send --subject "..."` overrides per send. Empty template = use built-in default.
- **`computeNextRun` uses JS Date semantics** — Jan 31 + 1 month rolls to Mar 3, Feb 29 + 1 year rolls to Mar 1. Documented as v1 behavior; if precise EOM semantics are needed later, swap to a date library or hand-roll.
- **`schedule-help` is print-only** — never invokes `crontab`/`launchctl`/`schtasks`. Outputs platform-appropriate snippets and exits.
- **Logo deferred to Phase 5** — `branding.logoUrl` is in the schema but the renderer ignores it.
- **`invoice config.cli.openPdfAfterPreview` config key name** is from the v1 plan and now misleading (no PDFs). Phase 3 polish should rename to `cli.openBrowserAfterPreview` once Phase 5 wires the dashboard URL.
- **Test files included in tsconfig** (no longer in `exclude`) so the IDE's TS server applies the project's types when typechecking test files. Side effect: `dist/` contains `.test.js`/`.test.d.ts` — harmless (the package exports field only exposes `./` → `./dist/index.js`).

### Phase-4.5 deviations

- **`LineItem.taxRate?: number`** added — per-line IGST possible; falls back to invoice-level `taxRate` at render time. Total IGST in the totals block is summed from the lines (always reconciles with the column).
- **`branding.signatureUrl` + `branding.signatoryLabel`** added to schema. The renderer reads a local file path via base64-embed; http(s):// URLs pass through; `file://` is supported. Unreadable path → block silently omitted. `signatoryLabel` defaults to `"Authorised Signatory"` at render time when undefined.
- **`{COMPANY3}` template variable** in `renderInvoiceNumber` — first 3 non-whitespace chars of `config.company.name`, uppercased. Used by every callsite (`new`, `clone`, `template use`, `recurring generate`). Function signature gained an optional 4th `companyName` arg.
- **`DEFAULT_FIELDS` grew to 25** with `lineItemHeader` (default "Description"). The renderer reads it for the line-item table column header.
- **Mixed-precision Rate column** via `formatCurrencyMaybeInt` (`₹55,000` for whole, `₹55,000.50` for fractional). All other currency cells use `formatCurrency` (always 2 decimals).
- **PDF generation deliberately not added back** despite the target being a PDF — we still emit HTML and rely on `window.print()` for paper output. React Email migration is the still-deferred Phase 4.5b.

### Phase-4.6 deviations

- **`invoice init` reordered** — Identity → Company info (optional) → Invoice number format (defaults to `{COMPANY3}-{YYYY}-{SEQ}` when company.name set) → SMTP → IMAP → Recipients → Optional sections (bank / tax / mail / branding / line-header). Company name is captured early specifically so the number-format default can use `{COMPANY3}`.
- **Setup helpers live in `init.ts`** (exported) — `setupCompany`, `setupBank`, `setupTax`, `setupMail`, `setupBranding`, `setupLineItemHeader`, `setupNumberFormat`, plus `readMultiline` utility. The new `setup.ts` imports them. Co-located to avoid circular deps.
- **`branding.signatoryLabel`** Zod schema changed from `.default('Authorised Signatory')` to `.optional()`. The default-with-value made the type `string` (always present), which forced workarounds in `setupBranding` when the user clears the field. Renderer already falls back to `'Authorised Signatory'` when undefined, so optional schema is cleaner. **Existing configs that have `signatoryLabel` set keep their value**; nothing to migrate.
- **Resolver accepts 3 ref types** (`packages/cli/src/resolver.ts`) — full UUID, ≥4-char hex prefix, or invoice number. Short prefix has a 4-char minimum to avoid `"1"` matching everything; invoice number lookup bypasses the length guard so short numeric numbers like `"42"` still work. Ambiguity produces a friendly listing.
- **`exitWithResolveError(ref, result)` returns `never`** so TS narrows `result.ok` to `true` after the guard. Used in `send` / `mark` / `clone`.
- **`mail.recipients` is init-only**: `invoice setup mail` updates subject/body/replyTo but explicitly overlays existing recipients back into the saved object. Recipients aren't part of the mail setup flow because they were already collected via the dedicated recipients prompt at init time.
- **`invoice list` Id column** — first 8 chars by default; `--full-id` shows the 36-char UUID. Short-id mode appends a footer hint about the resolver.

### Phase-4.7 deviations

- **`config.customers` lives inline in `config.json`** as `Record<slug, CustomerData>` (per user preference: "all information in a single config"). Atomic writes via `saveConfig`. ~200 bytes per entry; even 50 customers stays well under 10 KB. Zod schema in `packages/shared/src/config-schema.ts` declares it with `.default({})` so old configs keep parsing.
- **`customerSlug` added to `DEFAULT_FIELDS`** — stored on `invoice.default.customerSlug` when the user picks a saved customer at `invoice new` time. Marks "linked to the directory" so the send pipeline can read customer-level recipient defaults via `getCustomer(config, slug)`. **Not backfilled post-save** when save-on-send creates a customer for an already-sent invoice — that would diverge from the JSON sidecar that already shipped.
- **Save-on-send is gated** — `maybePromptSaveCustomer` skips when (a) the slug already resolves, OR (b) the customer's display name matches a directory entry case-insensitively, OR (c) the invoice has no customer name. Slug-collision (two different display names slugging to the same key) prints a skip notice rather than silently overwriting.
- **`performSend` is the orchestrator boundary** (`packages/cli/src/commands/send.ts`). `invoice send`, `clone --send`, `template use --send`, `recurring generate --send`, and `invoice resend` all funnel through it. Returns `'sent' | 'aborted' | 'error'` — the caller decides whether to exit. `resend` hands it a `{...invoice, status: 'draft'}` clone so the already-sent guard doesn't bail, then the upsert overwrites the row with the new sent state.
- **`recurring generate --send` re-loads config per iteration** so a save-on-send save in draft N is visible when checking draft N+1's customer. The whole batch keeps going if one send errors (so a single SMTP hiccup doesn't strand the rest).
- **`composeRecipients(config, invoice, opts)` is a pure module** (`packages/cli/src/recipients.ts`) with its own unit tests. Precedence per field: CLI override → customer default (if non-empty) → global default. `bcc` skips the customer layer (customers carry no bcc field).
- **Subject placeholders expanded from 6 → 17** (`packages/shared/src/email-format.ts`). Dictionary-driven replacement loop replaces the earlier 6-arm chain. Date pieces parse `issueDate` as UTC and format via `Intl.DateTimeFormat(..., timeZone: 'UTC')` so `2026-05-17` always says `May 17`, regardless of host TZ. Malformed dates → empty date pieces (no throw).
- **Generic draft persistence** in `packages/cli/src/drafts.ts` (`loadDraft/saveDraft/clearDraft/draftExists`) — parametrized by name (`'init'`, `'new'`). Files at `~/.invoice/<name>.draft.json`, mode 0600. Both `invoice init` and `invoice new` persist after every section/prompt and clear on success.
- **`findCustomerSlug(config, ref)`** mirrors `getCustomer` but returns the matching slug instead of the data — used by `invoice new --customer` to set `customerSlug` on the invoice. `getCustomer` left unchanged for backwards compatibility.
- **`invoice send` argument is now `[id]` (optional)** — `--last` is the alternative. Mutually-exclusive validation prints a friendly error if both or neither is provided.
- **`mostRecent(invoices, { drafts })`** in `packages/cli/src/recency.ts` — pure helper used by both `invoice last` and `invoice send --last`. Sort DESC: `issueDate`, then `sentAt` (drafts have null and sort last within an issueDate tie), then `invoiceNumber` lexicographically.

When you complete a phase, update this section so the next session knows where things stand.

## Conventions

- **TypeScript strict mode from day one.** No `any` outside justified narrow places.
- **No comments by default.** Only add a comment if the _why_ is non-obvious — a hidden constraint, a deliberate workaround, or behavior that would surprise a reader. Don't explain _what_ the code does; named identifiers do that.
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

# CLI (Phase 4.7 — productivity shortcuts)
invoice last [--drafts]              # print the most-recent invoice
invoice send --last                  # send the most-recent draft
invoice new --customer "Acme Corp"   # skip the picker, pre-pick a saved customer
invoice resend <id>                  # re-send an already-sent invoice
invoice search <text>                # substring search across number/customer/raw JSON
invoice ls                           # alias for `invoice list`
invoice customer save|list|show|delete
invoice clone <id> --send --yes      # chain create→send
invoice template use <name> --send
invoice recurring generate --send    # send each generated draft

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
