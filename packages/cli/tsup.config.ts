import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  noExternal: [/^@invoice\//],
  skipNodeModulesBundle: true,
  removeNodeProtocol: false,
  banner: {
    js: '#!/usr/bin/env -S node --no-warnings=ExperimentalWarning',
  },
});
