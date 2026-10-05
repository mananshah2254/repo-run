import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir('dist-electron', { recursive: true });
await build({
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-electron/main.cjs',
  external: ['electron'],
  sourcemap: true,
});
await build({
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-electron/preload.cjs',
  external: ['electron'],
});
await writeFile(
  'dist-electron/config.json',
  JSON.stringify({
    supabaseUrl: process.env.REPO_RUN_SUPABASE_URL || '',
    supabaseKey: process.env.REPO_RUN_SUPABASE_ANON_KEY || '',
  }),
);
