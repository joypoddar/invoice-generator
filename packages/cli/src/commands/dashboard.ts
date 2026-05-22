import type { Command } from 'commander';
import open from 'open';
import { startServer } from '@invoice/dashboard';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';
import { exitWithResolveError, resolveInvoice } from '../resolver.js';

interface DashboardOptions {
  port?: string;
  noOpen?: boolean;
}

export function register(program: Command): void {
  program
    .command('dashboard [id]')
    .description(
      'Open the local Hono dashboard in your browser. Use the Print button on the detail page to save the invoice as a PDF.',
    )
    .option('-p, --port <number>', 'override the dashboard port (default: config.dashboard.port)')
    .option('--no-open', 'start the server but do not open the browser')
    .action(runDashboard);
}

async function runDashboard(id: string | undefined, opts: DashboardOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const port = opts.port ? Number(opts.port) : config.dashboard.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${opts.port}`);
    process.exit(1);
  }

  // Resolve id (if given) to its full UUID so the URL path matches what the
  // dashboard's `GET /invoices/:id` will look up via `store.get(id)`.
  let invoicePath = '/invoices';
  if (id) {
    const store = new SqliteStore(dbPath());
    try {
      const result = await resolveInvoice(store, id);
      if (!result.ok) exitWithResolveError(id, result);
      invoicePath = `/invoices/${result.invoice.id}`;
    } finally {
      store.close();
    }
  }

  const server = startServer({
    port,
    dbPath: dbPath(),
    localUserName: config.name,
    renderOpts: {
      branding: {
        ...config.branding,
        signatoryLabel: config.branding.signatoryLabel,
      },
      dateFormat: config.invoice.dateFormat,
      currencyFormat: config.invoice.currencyFormat,
    },
  });

  const url = `http://127.0.0.1:${port}${invoicePath}`;
  console.log(`Dashboard running at http://127.0.0.1:${port}`);
  console.log(`  → ${url}`);
  console.log('Press Ctrl+C to stop.');

  if (opts.noOpen !== true) {
    try {
      await open(url);
    } catch {
      // No DISPLAY / headless environment — server still runs, user can curl
      // or paste the URL into a browser on the same machine.
    }
  }

  // Block until Ctrl+C, then stop cleanly.
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\nStopping dashboard…');
      void server.stop().then(() => resolve());
    });
  });
}
