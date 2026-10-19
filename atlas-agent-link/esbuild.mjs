import esbuild from 'esbuild';
await esbuild.build({ entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'node', target: 'es2022',
  external: ['obsidian', 'electron', 'node:*', 'http', 'crypto', 'events'], outfile: 'main.js', logLevel: 'info' });
