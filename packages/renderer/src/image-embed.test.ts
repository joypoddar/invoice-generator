import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveImageSrc } from './image-embed.js';

describe('resolveImageSrc', () => {
  it('passes http(s) URLs through unchanged', () => {
    expect(resolveImageSrc('https://example.com/logo.png')).toBe('https://example.com/logo.png');
  });

  it('passes data URLs through unchanged', () => {
    expect(resolveImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('returns null for an unreadable path', () => {
    expect(resolveImageSrc('/no/such/file.png')).toBeNull();
  });

  it('base64-embeds a local file with the right MIME', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voucher-logo-'));
    const file = join(dir, 'logo.svg');
    writeFileSync(file, '<svg/>');
    const src = resolveImageSrc(file);
    expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(src).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`);
  });

  it('accepts file:// URLs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voucher-logo-'));
    const file = join(dir, 'logo.png');
    writeFileSync(file, 'PNGDATA');
    const src = resolveImageSrc(pathToFileURL(file).href);
    expect(src).toBe(`data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`);
  });
});
