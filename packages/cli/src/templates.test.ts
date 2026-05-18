import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import {
  deleteTemplate,
  ensureTemplatesDir,
  listTemplates,
  loadTemplate,
  materializeFromTemplate,
  saveTemplate,
  templateExists,
  templateFromInvoice,
  templatePath,
  templatesDir,
} from './templates.js';

function makeInvoice(): Invoice {
  return {
    id: 'src-1',
    default: {
      invoiceNumber: 'INV-2026-0001',
      issueDate: '2026-01-15',
      dueDate: '2026-02-14',
      fromName: 'Joy',
      fromEmail: 'joy@creowis.com',
      companyName: 'Creowis',
      customerName: 'Acme',
      customerEmail: 'pay@acme.com',
      customerAddress: 'Mumbai',
      lineItems: [
        { description: 'Monthly retainer', quantity: 1, unitPrice: 100000 },
        { description: 'Setup', quantity: 1, unitPrice: 5000 },
      ],
      currency: 'INR',
      taxRate: 0.18,
      taxLabel: 'GST',
      taxAmount: 18900,
      bankAccountName: 'Joy',
      bankAccountNumber: '111222333',
      paymentInstructions: 'Wire',
      notes: 'Thanks',
    },
    custom: { purchaseOrderNumber: 'PO-001' },
    status: 'sent',
    sentAt: '2026-01-15T10:00:00Z',
    recipients: { to: ['hello@creowis.com'] },
    paymentStatus: 'paid',
    paidAt: '2026-01-20T09:00:00Z',
  };
}

describe('templates module', () => {
  let tmp: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'invoice-tpl-test-'));
    originalHome = process.env.INVOICE_HOME;
    process.env.INVOICE_HOME = tmp;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.INVOICE_HOME;
    else process.env.INVOICE_HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('paths', () => {
    it('templatesDir() lives under invoiceDir()', () => {
      expect(templatesDir()).toBe(join(tmp, 'templates'));
    });

    it('templatePath() rejects invalid names', () => {
      expect(() => templatePath('../etc/passwd')).toThrow();
      expect(() => templatePath('with space')).toThrow();
      expect(() => templatePath('foo/bar')).toThrow();
      expect(templatePath('valid-name_1.0')).toContain('valid-name_1.0.json');
    });
  });

  describe('save / load / list / delete round-trip', () => {
    it('lists empty when no templates exist', () => {
      expect(listTemplates()).toEqual([]);
    });

    it('saves a template and reads it back', () => {
      const inv = makeInvoice();
      const template = templateFromInvoice(inv);
      saveTemplate('monthly-acme', template);
      const loaded = loadTemplate('monthly-acme');
      expect(loaded).toEqual(template);
    });

    it('lists saved templates sorted', () => {
      ensureTemplatesDir();
      saveTemplate('zzz', templateFromInvoice(makeInvoice()));
      saveTemplate('aaa', templateFromInvoice(makeInvoice()));
      saveTemplate('mmm', templateFromInvoice(makeInvoice()));
      expect(listTemplates()).toEqual(['aaa', 'mmm', 'zzz']);
    });

    it('templateExists reflects the filesystem', () => {
      expect(templateExists('foo')).toBe(false);
      saveTemplate('foo', templateFromInvoice(makeInvoice()));
      expect(templateExists('foo')).toBe(true);
    });

    it('delete removes the file and returns true; false on missing', () => {
      saveTemplate('to-delete', templateFromInvoice(makeInvoice()));
      expect(deleteTemplate('to-delete')).toBe(true);
      expect(templateExists('to-delete')).toBe(false);
      expect(deleteTemplate('does-not-exist')).toBe(false);
    });

    it('loadTemplate returns null when missing', () => {
      expect(loadTemplate('missing')).toBeNull();
    });
  });

  describe('templateFromInvoice', () => {
    it('strips per-send identity and state fields', () => {
      const inv = makeInvoice();
      const t = templateFromInvoice(inv);
      // Stripped from default
      expect(t.default).not.toHaveProperty('invoiceNumber');
      expect(t.default).not.toHaveProperty('issueDate');
      expect(t.default).not.toHaveProperty('dueDate');
      expect(t.default).not.toHaveProperty('taxAmount');
      // Top-level state not carried at all
      expect((t as unknown as Record<string, unknown>).id).toBeUndefined();
      expect((t as unknown as Record<string, unknown>).status).toBeUndefined();
      expect((t as unknown as Record<string, unknown>).sentAt).toBeUndefined();
      expect((t as unknown as Record<string, unknown>).recipients).toBeUndefined();
      expect((t as unknown as Record<string, unknown>).paymentStatus).toBeUndefined();
      expect((t as unknown as Record<string, unknown>).paidAt).toBeUndefined();
    });

    it('preserves customer, line items, bank, tax rate, company snapshot, notes, custom', () => {
      const inv = makeInvoice();
      const t = templateFromInvoice(inv);
      expect(t.default.customerName).toBe('Acme');
      expect(t.default.customerAddress).toBe('Mumbai');
      expect(t.default.lineItems).toEqual(inv.default.lineItems);
      expect(t.default.bankAccountName).toBe('Joy');
      expect(t.default.bankAccountNumber).toBe('111222333');
      expect(t.default.taxRate).toBe(0.18);
      expect(t.default.taxLabel).toBe('GST');
      expect(t.default.paymentInstructions).toBe('Wire');
      expect(t.default.notes).toBe('Thanks');
      expect(t.default.companyName).toBe('Creowis');
      expect(t.custom).toEqual({ purchaseOrderNumber: 'PO-001' });
    });
  });

  describe('materializeFromTemplate', () => {
    const overrides = {
      id: 'new-id',
      invoiceNumber: 'INV-2026-0002',
      issueDate: '2026-02-15',
      dueDate: '2026-03-17',
    };

    it('produces a fresh draft invoice', () => {
      const t = templateFromInvoice(makeInvoice());
      const inv = materializeFromTemplate(t, overrides);
      expect(inv.id).toBe('new-id');
      expect(inv.default.invoiceNumber).toBe('INV-2026-0002');
      expect(inv.default.issueDate).toBe('2026-02-15');
      expect(inv.default.dueDate).toBe('2026-03-17');
      expect(inv.status).toBe('draft');
      expect(inv.paymentStatus).toBe('unpaid');
      expect(inv.sentAt).toBeUndefined();
      expect(inv.paidAt).toBeUndefined();
      expect(inv.recipients).toBeUndefined();
    });

    it('preserves customer, line items, bank, tax fields', () => {
      const t = templateFromInvoice(makeInvoice());
      const inv = materializeFromTemplate(t, overrides);
      expect(inv.default.customerName).toBe('Acme');
      expect(inv.default.lineItems).toEqual([
        { description: 'Monthly retainer', quantity: 1, unitPrice: 100000 },
        { description: 'Setup', quantity: 1, unitPrice: 5000 },
      ]);
      expect(inv.default.taxRate).toBe(0.18);
      expect(inv.default.taxLabel).toBe('GST');
    });

    it('recomputes taxAmount from rate × subtotal at materialization time', () => {
      const t = templateFromInvoice(makeInvoice());
      const inv = materializeFromTemplate(t, overrides);
      // subtotal = 100000 + 5000 = 105000; 18% = 18900
      expect(inv.default.taxAmount).toBe(18900);
    });

    it('detaches custom so mutations do not leak to the template', () => {
      const t = templateFromInvoice(makeInvoice());
      const inv = materializeFromTemplate(t, overrides);
      (inv.custom as Record<string, unknown>).extra = 'x';
      expect(t.custom).not.toHaveProperty('extra');
    });
  });
});
