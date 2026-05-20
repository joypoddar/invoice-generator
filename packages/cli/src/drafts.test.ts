import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, draftExists, loadDraft, saveDraft } from './drafts.js';

describe('drafts', () => {
  let tmpHome: string;
  const originalHome = process.env.INVOICE_HOME;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'invoice-drafts-'));
    process.env.INVOICE_HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.INVOICE_HOME;
    else process.env.INVOICE_HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns null when no draft exists', () => {
    expect(loadDraft('init')).toBeNull();
    expect(draftExists('init')).toBe(false);
  });

  it('save then load round-trips arbitrary JSON', () => {
    const data = { name: 'Joy', email: 'joy@example.com', count: 42 };
    saveDraft('init', data);
    expect(draftExists('init')).toBe(true);
    expect(loadDraft('init')).toEqual(data);
  });

  it('overwriting saves the latest', () => {
    saveDraft('init', { step: 1 });
    saveDraft('init', { step: 2, extra: true });
    expect(loadDraft('init')).toEqual({ step: 2, extra: true });
  });

  it('clearDraft removes the file', () => {
    saveDraft('init', { x: 1 });
    expect(draftExists('init')).toBe(true);
    clearDraft('init');
    expect(draftExists('init')).toBe(false);
  });

  it('clearDraft on missing file is a no-op (does not throw)', () => {
    expect(() => clearDraft('nonexistent')).not.toThrow();
  });

  it('returns null when JSON is corrupted (does not crash)', () => {
    saveDraft('init', { ok: true });
    // Manually corrupt
    writeFileSync(join(tmpHome, 'init.draft.json'), 'not-json');
    expect(loadDraft('init')).toBeNull();
  });

  it('keeps separate names independent', () => {
    saveDraft('init', { kind: 'init' });
    saveDraft('new', { kind: 'new' });
    expect(loadDraft('init')).toEqual({ kind: 'init' });
    expect(loadDraft('new')).toEqual({ kind: 'new' });
    clearDraft('init');
    expect(loadDraft('init')).toBeNull();
    expect(loadDraft('new')).toEqual({ kind: 'new' });
  });
});
