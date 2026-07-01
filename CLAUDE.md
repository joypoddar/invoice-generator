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

The plan lays out 9 phases plus mid-phase polishes. **Phases 1, 4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, and 5 (slices 1 + 1.5) are complete** — the `invoice` binary ships:

- **Phase 1 (CLI MVP)** — `init / config / whoami / new / list / send / sync / mark`.
- **Phase 4 (Customer-facing invoice + recurring billing)** — branding-driven HTML rendering, `Intl`-based date/currency formatting, print CSS, customizable subject line, `invoice clone`, `invoice template (save/list/use/delete)`, `invoice recurring (create/list/show/delete/generate/schedule-help)`.
- **Phase 4.5 (PDF design parity)** — 6-column line-item table with per-line IGST, signature block (opt-in image embedding), MMM DD YYYY + ISO8601 + DD MMM YYYY date formats, `{COMPANY3}` template variable, configurable line-item header.
- **Phase 4.6 (Onboarding ergonomics + quick id access)** — `invoice init` extended with optional sections, `invoice setup <section>` for incremental edits, customer-address prompt in `invoice new`, short id column in `invoice list`, resolver accepting UUID / short prefix / invoice number for `send / mark / clone`.
- **Phase 4.7 (UX flows)** — init welcome banner + Ctrl+C-safe draft persistence (also wired into `invoice new`), SMTP/IMAP retry loops on verify failure, customer directory at `config.customers` with `invoice customer save/list/show/delete`, picker in `invoice new`, `--customer` flag, customer-aware recipient composition (`composeRecipients(config, invoice, opts)`), 17-placeholder subject templates (sender identity + date pieces), `--send` chaining on clone / template-use / recurring-generate, save-on-send prompt, and productivity shortcuts (`invoice last [--drafts]`, `invoice send --last`, `invoice resend`, `invoice search`, `invoice ls` alias).
- **Phase 4.8 (per-customer invoice numbering + drop redundant re-prompts)** — saved customers carry optional `numberFormat` + their own `nextSeq` counter; when a customer is picked at `invoice new` (or detected via `customerSlug` on a clone/template/recurring source), that format/counter wins. `{COMPANY3}` inside a customer's format resolves to the customer's name initials. Picking a saved customer (or resuming a draft past the customer step) **skips** the name/email/address prompts entirely — they no longer re-prompt with the "Press Enter on Line 1 to keep" hint that caused users to accidentally overwrite saved addresses.
- **Phase 4.9 (receive-only install)** — `invoice init` opens with `Set up sending (SMTP)? (Y/n)`. Saying `N` skips the SMTP block, default-recipients prompt, number-format prompt, and the mail subject/body/reply-to optional section. `smtp` and `mail` are now `.optional()` in the Zod schema. Send-side commands (`send`, `resend`, `clone --send`, `template use --send`, `recurring generate --send`) check `config.smtp` at runtime and print a friendly `"Sending isn't configured. Run \`invoice setup smtp\` to enable sending."`instead of a TypeError. New`invoice setup smtp`+`invoice setup recipients` subcommands let a receive-only install promote to sender later. IMAP folder picker gained a one-line hint explaining Sent vs INBOX. The README has a new "Setup recipes" section covering sender / account-head / dual-role-via-INVOICE_HOME.

- **Phase 4.10 (Billed-To phone + IFSC caps + picker default + validation)** — Billed To block now mirrors Billed By order (name → address → email → phone) and renders `customerPhone` (new field in `DEFAULT_FIELDS`, snapshotted from the saved customer or collected in the manual-entry path). IFSC is uppercased at three sites: `setupBank` input, `snapshotDefaults` in `new.ts`, and defensively at render time in `email.ts`. `invoice new` picker now defaults to the first saved customer (alphabetical) instead of `+ New customer`. New `packages/cli/src/validators.ts` exports `validateEmail/validateEmailList/validateIfsc` and wires them into six prompts in `init.ts` — invalid emails/IFSC now fail at the prompt with a clear message instead of at Zod-parse. `invoice resend <id>` (Phase 4.7) was verified intact, no code change.
- **Phase 5 slice 1 (Hono dashboard MVP — print-to-PDF)** — Renderer extracted to new `packages/renderer/` workspace package (so both the CLI's email path and the dashboard can use it without `@invoice/dashboard` taking on nodemailer/imapflow as transitive deps). New `packages/dashboard/` package: Hono + `@hono/node-server` on `127.0.0.1` only, server-rendered (no JSX runtime needed for the MVP — plain string templates), three routes (`/` → `/invoices`, `/invoices`, `/invoices/:id`). Detail page wraps the existing `renderInvoiceHtml` with a sticky `.no-print` toolbar containing `[← All invoices] [🖨 Print / Save as PDF]`; the Print button calls `window.print()` (which works because the dashboard is a real browser context, unlike email clients which strip JavaScript). New `invoice dashboard [id]` CLI command resolves an optional id via the standard resolver, spawns the server, opens the browser, blocks on SIGINT. The `--port` flag overrides `config.dashboard.port`; `--no-open` starts headless. **No PDF generation in the codebase** — the user prints to PDF via the browser's own dialog, preserving CLAUDE.md decision #6.
- **Phase 5 slice 1.5 (batch print + clean PDF filenames + browser-chrome suppression)** — Three follow-ups to slice 1: (a) `<title>` rewritten to `<sender_slug>_invoice_<number_slug>` (e.g., `john_doe_invoice_cre-2026-0001`) so the browser's Save-as-PDF dialog suggests a meaningful filename. New `slugify()` helper in `@invoice/renderer`. (b) `@page` margin changed from `1.5cm` to `0` with the 1.5cm restored as `.invoice-card` print padding — strips the browser's default URL header and timestamp footer from the PDF (Chrome reliably; Firefox/Safari mostly). (c) Checkbox column + sticky "Print selected" button on `/invoices`; new `GET /invoices/print?ids=<csv>` route renders selected invoices stacked with `page-break-before: always` between them, auto-fires `window.print()` 100ms after load. Batch title format: `<local_user_slug>_invoices_<YYYY-MM-DD>`. Selection cap at 50 (client-side warn + server-side defensive cap). Renderer refactored to expose `renderInvoiceCard` (just the card div) alongside `renderInvoiceHtml` (full document) so the batch view can stack N cards in one document.

**323 unit tests** pass across `shared`, `core`, `cli`, `renderer`, and `dashboard`. Manual end-to-end verification (`TESTING.md` § "Phase 4 verification" + "Phase 4.6 verification" + "Phase 4.7 verification" + "Phase 4.8 verification" + "Phase 4.9 verification" + "Phase 4.10 verification" + "Phase 5 verification" — sections P5.1–P5.11 + "Payment Voucher verification" — sections PV.1–PV.5) is the remaining item before Phase 5 slice 2 (sync widget) starts.

- **Payment Vouchers (out-of-band feature, not a numbered phase)** — a *paid-out* document, separate from invoices, stored in its own `vouchers` SQLite table, with the full CRUD-ish surface `invoice voucher new|list|mark|send|resend|clone|sync|print` and dashboard pages (`/vouchers`, `/vouchers/:id`, `/vouchers/print`). **It now has email send + sync parity with invoices** (an earlier "no email/sync" scope was reversed — see "Payment Voucher deviations"). Mirrors the reference "Employee Payment Voucher" design (dark logo banner, Payment To/Date/PV No. row, Serial/Method/Description/Amount table, Total, Amount-in-Words, Prepared/Received By). See "Payment Voucher deviations" below.

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

### Phase-4.8 deviations

- **`{COMPANY3}` is context-dependent** — it resolves from whatever `companyName` the caller passes to `renderInvoiceNumber`. Callers using a customer's `numberFormat` pass `customer.name`; callers using the global format pass `config.company.name`. Same placeholder, two data sources. Old global-format usage is untouched; the new per-customer path lights up automatically when a customer has a `numberFormat` set.
- **Per-customer counter lives at `config.customers[<slug>].nextSeq`** (defaults to 1 via Zod). Customers without `numberFormat` still carry the field, but it's only bumped when the customer's format is actually consulted. Global `config.invoice.nextSeq` continues to govern format-less customers and the `+ New customer` / no-saved-customer paths.
- **`resolveNumberSpec(config, customerSlug)`** in `packages/cli/src/invoice-number.ts` is the single decision point. Returns `{ format, seq, companyName, customerSlug? }`. The presence of `customerSlug` in the result tells the caller which counter to bump. Used by `new`, `clone`, `template use`, and `recurring generate`.
- **`recurring generate` accumulates per-customer counter deltas** in an in-memory `Record<slug, number>` alongside the existing `mutableNextSeq`. One `saveConfig` at the end via `applySeqUpdates(config, nextSeq, customerSeqs)` writes both. A customer that was deleted between schedule creation and `generate` falls back to the global counter cleanly (no crash, no spurious customer entries created).
- **`invoice new` defers number computation to after the customer step.** Source order is now: dates + id → customer pick/manual → per-field prompts → `resolveNumberSpec` → render. The `New invoice: <number>` print moves down accordingly. Resumes still reuse `draft.invoiceNumber` (no double bump).
- **Customer-detail prompts are now skip-if-known** — `const customerName = draft.customerName ?? await input(...)`. When a customer is picked, `applyPickedCustomer` populates `draft.customerName/customerEmail/customerAddress` _only for fields the customer record has_, so missing fields still get prompted. This avoids the silent-overwrite class of bugs the multi-line "Press Enter to keep" hint enabled.
- **`bumpCustomerSeq(config, slug)`** is a small immutable helper on `customers.ts`. Returns the same config if the slug doesn't exist (defensive — no-op rather than throw).
- **Existing configs migrate automatically.** Saved customers without `nextSeq` get `1` via Zod default; `numberFormat` stays `.optional()`. No migration command needed.

### Phase-4.9 deviations

- **`smtp` and `mail` are now `.optional()` at the top of the Zod schema.** Capability is implicit — does `config.smtp` exist? — not a stored role. This deliberately preserves CLAUDE.md's "no role separation in the codebase" invariant: there is no `config.role`, no `auth.ts`, no admin namespace. The init flow's `wantsSending` choice doesn't get stored as a config field; it just determines whether the SMTP/mail blocks get persisted.
- **`InitDraft.wantsSending: boolean | undefined`** — first prompt's answer. Defaults to `true` for a fresh install (existing `smtp` present) and `false` for a re-init of a receive-only setup. Persisted to `~/.invoice/init.draft.json` so a Ctrl+C mid-flow resumes correctly.
- **`performSend` short-circuits with friendly errors** when `config.smtp` is undefined OR `config.mail` is undefined OR `config.mail.recipients.to` is empty. Each path prints a `"... Run \`invoice setup smtp\` to enable sending."`message and returns`'error'` (caller decides whether to exit). All five send-side entry points (`send`, `resend`, `clone --send`, `template use --send`, `recurring generate --send`) flow through `performSend`, so this single check covers them all.
- **`composeRecipients` tolerates absent `config.mail`** by treating global recipient lists as `[]`. The send pipeline's empty-`to` check then catches the misconfiguration before SMTP is touched. Customer-default and CLI override paths work unchanged.
- **`setupMail`'s param + return tightened to `NonNullable<Config['mail']>`** — the helper always _produces_ a populated mail object; callers handle the absent case before invoking it. `runMail` in `setup.ts` checks `config.mail` and bails with a hint to run `setup smtp` first.
- **`invoice setup smtp` writes the keychain entry** in addition to persisting `config.smtp`. Seeds an empty `mail.recipients` block so the next failure on `invoice send` points at the missing recipients (clearer error) rather than at missing mail entirely. **`invoice setup recipients`** refuses to save an empty list. Both reuse the existing `collectSmtp` / a new `setupRecipients` helper exported from `init.ts`.
- **`invoice config doctor`** treats absent `smtp` as a legitimate state (`"SMTP: not configured (receive-only install)"`) rather than a failure. Only flags missing `imap-app-password` as a hard error.
- **IMAP folder picker hint** prints one line above the `select` prompt: `"Tip: your own Sent folder = see invoices you sent. INBOX of a shared mailbox (e.g., hello@creowis.com) = see invoices the team received."` Helps first-time users pick without needing to read PLAN.md.
- **Dual-role pattern lives in README "Setup recipes"** — two `INVOICE_HOME` dirs, one per hat. No code change supports it; it already worked. Documented because it wasn't obvious.

### Phase-4.10 deviations

- **`customerPhone` added to `DEFAULT_FIELDS`** in `packages/shared/src/invoice.ts`. `applyPickedCustomer` in `new.ts` copies the customer's `phone` into the draft only when present; `snapshotDefaults` carries it onto the invoice. The renderer's Billed To block reads it via `pickField(invoice, 'customerPhone')` and renders the same `<strong>Phone:</strong>` label format as Billed By.
- **Billed To order changed to match Billed By**: was `name → email → address`, now `name → address → email → phone`. Visual hierarchy now mirrors the Billed By column above it.
- **`invoice new` manual-entry path gained a `Customer phone (optional):` prompt** after the address prompt. Picked customers still skip it (data already in draft); manual-entry customers get the chance to add a phone that'll appear in Billed To.
- **IFSC normalization happens at three sites**, not just one: (a) `setupBank` in init.ts uppercases the user's input before persisting; (b) `snapshotDefaults` in new.ts uppercases `c.bank.ifsc` when writing to `invoice.default.bankIfsc` (defends against pre-4.10 configs that have lowercase); (c) `email.ts` defensively `.toUpperCase()`s `bankIfsc` at render time so old invoices/configs with lowercase still render correctly.
- **Picker default = first saved customer** (`saved[0]?.[0]`), not the `+ New customer` sentinel. The picker already sorts customers alphabetically via `listCustomers`, so this is deterministic. Common path (billing an existing customer) is one Enter; brand-new customer takes an arrow-down.
- **Shared `validators.ts`** exports three `validate:` factory functions for `@inquirer/prompts.input(...)`. Each returns `true` on success or an error string. `allowEmpty: boolean` parameterizes the required-vs-optional case so the same validator works for both `Your email:` (required) and `Email (optional):` (allowed empty). Used in 6 prompts across `init.ts`.
- **IFSC validator is non-strict on the second pass**: pattern `[A-Z]{4}0[A-Z0-9]{6}`. The prompt currently re-loops until valid (matching the existing `validate:` behavior in inquirer). Edge case: a user with a non-Indian bank account can leave IFSC blank (`allowEmpty=true`); the field stays optional in the schema.
- **No auto-migration of existing lowercase IFSCs at config-load time** — the defensive render-time uppercase covers display. The persisted value gets fixed the next time the user runs `invoice setup bank`. This avoids surprising users with silent config rewrites.

### Phase-5-slice-1 deviations

- **`@invoice/renderer` is a new workspace package**, not part of `@invoice/shared` or `@invoice/core`. Reason: the renderer uses `node:fs` for the optional signature-embed path, which is OK for shared (it's already Node-side) but tying it to shared adds a heavy dep to a small types package. A standalone package keeps the import graph clean: `cli/email.ts` and `dashboard/views/invoice-detail.ts` both depend on `@invoice/renderer`, with no shared.ts ↔ renderer tangle.
- **`cli/src/email.ts` re-exports `renderInvoiceHtml`, `BrandingOpts`, `RenderOpts`** so existing callers (and the `email.test.ts`'s `buildMailOptions` tests) compile without churn. Internally everything routes through the new package.
- **Dashboard uses plain string templates, not Hono JSX** despite `jsx: "react-jsx"` + `jsxImportSource: "hono/jsx"` being in `tsconfig.json`. Reason: the views are mostly delegating to `renderInvoiceHtml` (which returns a string) and assembling small wrapper HTML — JSX would add ceremony without benefit for slice 1. Slice 2+ can introduce `.tsx` views when there's actual JSX-worthy structure (forms, interactive widgets).
- **Toolbar is injected via a `body`-tag string replace**, not as a JSX wrapper around `renderInvoiceHtml`. `injectToolbar(html)` runs a single regex `replace(/<body([^>]*)>/, ...)` and is the only place the renderer's output is touched. Keeps the renderer ignorant of dashboard chrome.
- **`window.print()` works in the dashboard but NOT in email** — this is the entire point. Email clients strip `<script>` and `onclick` for security; real browsers don't. The print button is the dashboard's headline feature, and customers who want a PDF use their mail client's built-in Print menu (or open the email in a browser and Cmd+P).
- **127.0.0.1-only binding is hard-coded** in `packages/dashboard/src/server.ts` (passed as `hostname` to `@hono/node-server.serve`). No config knob to bind elsewhere — this is a security property per CLAUDE.md decision #11.
- **Graceful Ctrl+C**: `invoice dashboard` registers a `SIGINT` handler that calls `server.stop()` and resolves the blocking promise. The server.ts `stop()` returns a Promise that resolves when the underlying socket is closed. No zombie sockets even when the user presses Ctrl+C mid-render.
- **`--no-open` flag** for headless / SSH scenarios (e.g., running the dashboard on a remote box that has no DISPLAY). The server still runs; the user pastes the URL into a browser on the same machine. Falls back gracefully if `open()` throws (no DISPLAY environment), too.
- **Slice 2 (sync widget), slice 3 (paid toggle), slice 4 (analytics), slice 5 (CSV export)** are deliberately not in slice 1. PLAN.md's "out of scope (deferred to later slices)" lists them. Each can land independently.

### Phase-5-slice-1.5 deviations

- **`slugify` lives in `@invoice/renderer`**, not `@invoice/shared`. Reason: the slug is a renderer concern (it goes into the document `<title>` which drives PDF filenames). Keeping it adjacent to `renderInvoiceHtml` means future changes to the title format are one-file edits.
- **`PRINT_CSS` is a top-level exported const** in `packages/renderer/src/invoice-html.ts`. Both `renderInvoiceHtml` (single) and the dashboard's `renderInvoiceBatchPage` paste it into their `<head>`. Single source of truth for `@page { margin: 0 }` + the `.no-print` rule + page-break protection.
- **`renderInvoiceCard` was extracted from `renderInvoiceHtml`** as an exportable function returning just the `<div class="invoice-card">…</div>` block. `renderInvoiceHtml` is now a thin wrapper that adds the doctype/html/head/body chrome around `renderInvoiceCard`'s output. The batch view stacks N `renderInvoiceCard` outputs in one document.
- **`@page { margin: 0 }` is the chrome-suppression trick**, not `display:none` on the headers/footers (which aren't part of the DOM and can't be hidden via CSS). The 1.5cm we removed from the page margin is restored as `.invoice-card { padding: 1.5cm !important }` inside `@media print` so visual breathing room is preserved.
- **Backticks in TypeScript template literals**: my first attempt to add a CSS comment containing `` `padding` `` (with backticks for emphasis) closed the surrounding template literal early. Lesson: when authoring HTML/CSS strings inside template literals, avoid backticks in the prose. Switched to plain quoting.
- **Batch route registered BEFORE `/invoices/:id`** in `server.ts`. Hono's route matching is greedy; if `/invoices/:id` is registered first, `/invoices/print` falls through to the detail handler treating `print` as an id.
- **Batch route caps at 50 server-side too**, not just in the list-page JS. Defensive — if someone hand-crafts a URL with 200 ids, the server only fetches the first 50. Prevents accidental 200-page PDF renders.
- **Batch filename uses `localUserName` (config.name) + today's date**, NOT per-invoice `fromName` or per-invoice dates. The batch is a one-time print artifact for the local user; consistency across mixed-sender selections is the right behavior.
- **Auto-fire window.print()** in the batch view uses `setTimeout(() => window.print(), 100)`. The 100ms gives the browser time to lay out N stacked cards before the print dialog snapshots. Without the timeout, Chrome occasionally prints with a half-rendered layout.
- **Empty `<input type="checkbox" name="invoice">`** lookups in the inline script are safe via `Array.from(...)` — even an empty NodeList iterates without error. No null-safety needed.
- **Test regex for `setTimeout(...window.print()...)`** needs `[\s\S]*?` (any-char-including-newlines, lazy), not `[^)]*`. The function expression `setTimeout(function () { window.print(); }, 100)` has a `)` after `function ()` that traps `[^)]*` early. Tripped me up in the first run.

### Payment Voucher deviations

- **Vouchers are a separate type/table/namespace — NOT an `Invoice` variant.** New `Voucher`/`VoucherLine` in `packages/shared/src/voucher.ts`; new `vouchers` table + `upsertVoucher/getVoucher/listVouchers/deleteVoucher` methods **on `SqliteStore`, not the `InvoiceStore` interface** (same documented precedent as the `recurring_*` methods — all voucher SQL stays in `core/sqlite-store.ts`, honoring decision #4). The full object round-trips through `raw_json`.
- **Email send + sync (scope reversed).** Originally "no email, no sync." Now: `voucher send`/`resend` email an HTML voucher + `voucher-<n>.json` sidecar with an **`X-Voucher-Generator: 1`** header, and `voucher sync [--backfill]` pulls sent vouchers back via `parseVoucherSidecar`/`ingestVouchers` (`core/ingest.ts`). `fetchSince` is parameterized by header so invoice/voucher searches share the folder but stay distinct streams. Voucher sync uses its **own** watermark — `voucher_sync_state` + `getVoucherLastUid/setVoucherLastUid` on `SqliteStore` — so it never clobbers the invoice `sync_state` watermark even on the same `config.imap.folder`. Send-state (`status/sentAt/recipients`) is persisted by `markVoucherSent` inside `performVoucherSend`.
- **`branding.logoUrl` is now used** (it was schema-only, ignored by the invoice renderer per the Phase-4 note). Only the **voucher** renderer reads it; `invoice-html.ts` is unchanged. Embedded via the new shared `resolveImageSrc` helper (`packages/renderer/src/image-embed.ts`), which is the extracted body of the old `resolveSignatureSrc` — both signature and logo now share it.
- **`config.voucher` block** added (`numberFormat` default `{INITIALS}_{MMM}{YY}_{SEQ}`, `nextSeq`, `title` default "Employee Payment Voucher", `defaultPaymentMethod`). `.default({})` + per-field defaults → existing configs migrate automatically.
- **`renderVoucherNumber`** (in shared) is voucher-specific: `{SEQ}` zero-pads to **2** (matches the `JP_May26_02` reference), adds `{INITIALS}`, `{MMM}`/`{MMMM}` month names, and `{YY}`. `{INITIALS}` = first letter of each word of `config.name` ("Joy Poddar" → "JP"). Global counter only — **no per-customer voucher numbering** (unlike invoices). Counter bumped via `saveConfig` after `voucher new`.
- **Voucher renderer uses a plain bordered table with a black/white header**, not the invoice's primary-colored line-item table — faithful to the reference image. Currency cells use the app-standard `formatCurrency` (`₹186.00`), not the image's literal "Rs.", for consistency with invoices. Body rows pad to a minimum of 5 for the ruled-ledger look.
- **Voucher print CSS:** `renderVoucherHtml` pastes the shared `PRINT_CSS` (for `@page margin:0` + `.no-print`) plus a small `VOUCHER_PRINT_EXTRA` block, because `PRINT_CSS`'s padding rule targets `.invoice-card` only — the voucher card is `.voucher-card`.
- **`invoice voucher print [id]`** reuses `startServer` + `open` like `commands/dashboard.ts`; id resolves by full UUID / ≥4-char prefix / exact PV number via a small local resolver in `commands/voucher.ts`.
- **`voucher new` mirrors `new.ts` ergonomics** (draft persistence under name `voucher-new`, saved-customer picker for the payee, line loop) but is simpler — no tax, no per-customer numbering.
- **`voucher clone` / `voucher resend` mirror the invoice equivalents.** `prepareVoucherClone` (pure, in `shared/voucher.ts`) resets `status/paymentStatus/sentAt/recipients/paidAt` and replaces id/number/date; the counter bump after clone mirrors `voucher new` (customer `nextSeq` vs global `config.voucher.nextSeq`). `resend` guards on `status==='sent'`, drafts a clone, and routes through `performVoucherSend`. Counter is now bumped after both `voucher new` and `voucher clone`.
- **Dashboard voucher batch print** mirrors invoices: checkboxes + "Print selected" on `/vouchers`, `GET /vouchers/print?ids=` (registered BEFORE `/vouchers/:id`), `renderVoucherBatchPage` stacking `renderVoucherCard` with `PRINT_CSS + VOUCHER_PRINT_EXTRA` (now exported from the renderer), reusing `BATCH_CAP` (50).

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
