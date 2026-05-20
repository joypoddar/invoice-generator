import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureInvoiceDir, invoiceDir } from './store.js';

/**
 * Generic draft persistence for interactive wizards (init, new). Stored at
 * `~/.invoice/<name>.draft.json` so a Ctrl+C or mid-wizard error doesn't lose
 * the user's typing. Cleared on successful completion.
 *
 * Drafts are intentionally NOT Zod-validated — we save partial state.
 */

function draftPath(name: string): string {
  return join(invoiceDir(), `${name}.draft.json`);
}

export function loadDraft<T>(name: string): T | null {
  const path = draftPath(name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function saveDraft<T>(name: string, draft: T): void {
  ensureInvoiceDir();
  const path = draftPath(name);
  writeFileSync(path, JSON.stringify(draft, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearDraft(name: string): void {
  const path = draftPath(name);
  if (existsSync(path)) unlinkSync(path);
}

export function draftExists(name: string): boolean {
  return existsSync(draftPath(name));
}
