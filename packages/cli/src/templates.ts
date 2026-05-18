import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  materializeFromTemplate,
  templateFromInvoice,
  type MaterializeOverrides,
  type Template,
} from '@invoice/core';
import { invoiceDir } from './store.js';

// Re-export so existing call sites importing from './templates.js' still work.
export {
  materializeFromTemplate,
  templateFromInvoice,
  type MaterializeOverrides,
  type Template,
};

const NAME_RE = /^[A-Za-z0-9._-]+$/;

export function templatesDir(): string {
  return join(invoiceDir(), 'templates');
}

export function templatePath(name: string): string {
  validateName(name);
  return join(templatesDir(), `${name}.json`);
}

export function ensureTemplatesDir(): void {
  const dir = templatesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function templateExists(name: string): boolean {
  return existsSync(templatePath(name));
}

export function listTemplates(): string[] {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

export function loadTemplate(name: string): Template | null {
  const path = templatePath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Template;
}

export function saveTemplate(name: string, template: Template): void {
  ensureTemplatesDir();
  const path = templatePath(name);
  writeFileSync(path, JSON.stringify(template, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function deleteTemplate(name: string): boolean {
  const path = templatePath(name);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Template name must be alphanumeric (with .-_); got: ${JSON.stringify(name)}`,
    );
  }
}
