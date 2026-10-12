import { cpSync, mkdirSync, rmSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/.openai', { recursive: true });
cpSync('worker/index.js', 'dist/server/index.js');
cpSync('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Built dist/server/index.js');
