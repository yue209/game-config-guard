import { existsSync, readFileSync } from 'node:fs';
const required = ['dist/server/index.js', 'dist/.openai/hosting.json'];
for (const file of required) if (!existsSync(file)) throw new Error(`Missing ${file}`);
const manifest = JSON.parse(readFileSync('dist/.openai/hosting.json', 'utf8'));
if (!manifest.project_id || 'static' in manifest) throw new Error('Invalid Worker hosting manifest');
await import(new URL('../dist/server/index.js', import.meta.url));
console.log('Artifact valid');
