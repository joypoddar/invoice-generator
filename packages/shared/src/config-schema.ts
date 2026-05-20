import { z } from 'zod';

export const ConfigSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  currency: z.string().length(3).default('USD'),

  invoice: z
    .object({
      numberFormat: z.string().default('INV-{YYYY}-{SEQ}'),
      nextSeq: z.number().int().nonnegative().default(1),
      defaultDueDays: z.number().int().nonnegative().default(30),
      defaultTaxRate: z.number().optional(),
      taxLabel: z.string().optional(),
      defaultNotes: z.string().optional(),
      paymentInstructions: z.string().optional(),
      dateFormat: z.string().optional(),
      currencyFormat: z.string().optional(),
      lineItemHeader: z.string().default('Description'),
    })
    .default({}),

  company: z
    .object({
      name: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      website: z.string().optional(),
      taxId: z.string().optional(),
    })
    .default({}),

  branding: z
    .object({
      primaryColor: z.string().optional(),
      fontFamily: z.string().optional(),
      logoUrl: z.string().optional(),
      signatureUrl: z.string().optional(),
      signatoryLabel: z.string().optional(),
    })
    .default({}),

  bank: z
    .object({
      accountName: z.string().optional(),
      accountNumber: z.string().optional(),
      ifsc: z.string().optional(),
      accountType: z.string().optional(),
      bankName: z.string().optional(),
    })
    .default({}),

  customers: z
    .record(
      z.string(),
      z.object({
        name: z.string().min(1),
        email: z.string().email().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        defaultRecipientTo: z.array(z.string().email()).default([]),
        defaultRecipientCc: z.array(z.string().email()).default([]),
      }),
    )
    .default({}),

  smtp: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    user: z.string().min(1),
  }),

  imap: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    user: z.string().min(1),
    folder: z.string().min(1),
  }),

  mail: z.object({
    recipients: z.object({
      to: z.array(z.string().email()).min(1),
      cc: z.array(z.string().email()).default([]),
      bcc: z.array(z.string().email()).default([]),
    }),
    subjectTemplate: z.string().optional(),
    bodyTemplate: z.string().optional(),
    replyTo: z.string().email().optional(),
  }),

  sync: z
    .object({
      maxBackfillMonths: z.number().int().positive().default(12),
    })
    .default({}),

  storage: z
    .object({
      backend: z.enum(['sqlite']).default('sqlite'),
      dbPath: z.string().optional(),
    })
    .default({}),

  dashboard: z
    .object({
      port: z.number().int().positive().default(3000),
      host: z.string().default('127.0.0.1'),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      defaultSort: z.string().optional(),
      defaultFilter: z.string().optional(),
    })
    .default({}),

  git: z
    .object({
      enabled: z.boolean().default(false),
      remote: z.string().optional(),
      autoCommit: z.boolean().default(false),
      autoPush: z.boolean().default(false),
      commitMessageTemplate: z.string().optional(),
      pushRetries: z.number().int().nonnegative().default(3),
    })
    .default({}),

  cli: z
    .object({
      editor: z.string().optional(),
      confirmBeforeSend: z.boolean().default(true),
      openPdfAfterPreview: z.boolean().default(false),
      locale: z.string().optional(),
      logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    })
    .default({}),

  llm: z
    .object({
      provider: z
        .enum(['ollama', 'lmstudio', 'openai-compatible', 'disabled'])
        .default('disabled'),
      endpoint: z.string().optional(),
      model: z.string().optional(),
      temperature: z.number().optional(),
      maxTokens: z.number().int().positive().optional(),
      systemPromptOverride: z.string().optional(),
      features: z
        .object({
          nlInvoiceCreate: z.boolean().default(false),
          chatQuery: z.boolean().default(false),
          draftReminders: z.boolean().default(false),
          summarize: z.boolean().default(false),
        })
        .default({}),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
