import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    clean: false,
    target: 'node18',
  },
  {
    // `npx post-upload mcp` — CommonJS so it runs regardless of the caller's module type.
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    target: 'node18',
  },
]);
