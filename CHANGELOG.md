# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-beta.1] — 2026-05-27

First beta of the `invoice` CLI. Ships the CLI MVP, recurring billing, customer
directory, productivity shortcuts, and the local Hono dashboard with
print-to-PDF.

### CLI

- **Phase 1 — CLI MVP**: `init`, `config`, `whoami`, `new`, `list`, `send`,
  `sync`, `mark`. Email is the source of truth; SQLite is a derived index
  rebuildable via `invoice sync --backfill`. Secrets live in the OS keychain.
- **Phase 4 — Customer-facing invoice + recurring**: branding-driven HTML
  rendering, `Intl`-based date/currency formatting, print CSS, customizable
  subject line, `invoice clone`, `invoice template` (save/list/use/delete),
  `invoice recurring` (create/list/show/delete/generate/schedule-help).
- **Phase 4.5 — PDF design parity**: 6-column line-item table with per-line
  IGST, signature block (opt-in image embedding), MMM DD YYYY + ISO8601 + DD
  MMM YYYY date formats, `{COMPANY3}` template variable, configurable
  line-item header.
- **Phase 4.6 — Onboarding ergonomics**: `invoice init` extended with optional
  sections, `invoice setup <section>` for incremental edits, customer-address
  prompt in `invoice new`, short id column in `invoice list`, resolver
  accepting UUID / short prefix / invoice number for `send / mark / clone`.
- **Phase 4.7 — UX flows**: init welcome banner + Ctrl+C-safe draft
  persistence (also wired into `invoice new`), SMTP/IMAP retry loops on
  verify failure, customer directory at `config.customers` with
  `invoice customer save/list/show/delete`, picker in `invoice new`,
  `--customer` flag, customer-aware recipient composition,
  17-placeholder subject templates, `--send` chaining on clone /
  template-use / recurring-generate, save-on-send prompt, productivity
  shortcuts (`invoice last`, `invoice send --last`, `invoice resend`,
  `invoice search`, `invoice ls`).
- **Phase 4.8 — Per-customer invoice numbering**: saved customers carry
  optional `numberFormat` + their own `nextSeq` counter; picking a customer
  at `invoice new` uses their format/counter. `{COMPANY3}` inside a customer's
  format resolves to the customer's initials. Picking a saved customer skips
  the name/email/address prompts.
- **Phase 4.9 — Receive-only install**: `invoice init` asks
  `Set up sending (SMTP)? (Y/n)`. Saying `N` skips the SMTP/recipients/number
  format/mail blocks. `smtp` and `mail` are `.optional()`. Send-side commands
  print a friendly hint when sending isn't configured. New
  `invoice setup smtp` + `invoice setup recipients` to promote receive-only
  to sender. IMAP folder picker gained a one-line hint.
- **Phase 4.10 — Billed-To phone + IFSC caps + picker default + validation**:
  Billed To block now mirrors Billed By order (name → address → email →
  phone) and renders `customerPhone`. IFSC is uppercased at three sites.
  Picker defaults to first saved customer alphabetically. New
  `packages/cli/src/validators.ts` exports `validateEmail`,
  `validateEmailList`, `validateIfsc`, wired into six prompts.

### Dashboard

- **Phase 5 slice 1 — Hono dashboard MVP (print-to-PDF)**: renderer extracted
  to new `@invoice/renderer` workspace package. New `@invoice/dashboard`:
  Hono + `@hono/node-server` on `127.0.0.1` only, server-rendered, three
  routes (`/` → `/invoices`, `/invoices`, `/invoices/:id`). Detail page
  injects a sticky toolbar with `[← All invoices] [🖨 Print / Save as PDF]`.
  New `invoice dashboard [id]` CLI command. No PDF generation in the
  codebase — the browser handles Print to PDF.
- **Phase 5 slice 1.5 — batch print + clean PDF filenames + chrome
  suppression**: document `<title>` rewritten to
  `<sender_slug>_invoice_<number_slug>`. `@page { margin: 0 }` strips
  browser URL header and timestamp footer. New "Print selected" sticky
  button on `/invoices` + `GET /invoices/print?ids=<csv>` route renders
  selected invoices stacked with `page-break-before: always`; selection
  capped at 50.

### Tests

- 289 unit tests across `shared`, `core`, `cli`, `renderer`, `dashboard`.

[0.1.0-beta.1]: https://github.com/joypoddar/invoice-generator/releases/tag/v0.1.0-beta.1
