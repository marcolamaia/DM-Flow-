import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // esbuild (vitest's default transform) does not emit decorator metadata, so Nest
  // would silently inject undefined dependencies. SWC emits it correctly.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    // Integration tests share one Postgres schema, so they must not race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
