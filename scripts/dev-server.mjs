import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import worker from '../worker/index.js';

// Keep local secrets out of Git while making subsequent starts zero-config.
// Existing shell variables win over values saved in local env files.
for (const file of ['.env.local', '.env', '.dev.vars']) {
  if (!existsSync(file)) continue;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const port = Number(process.env.PORT || 8788);
http.createServer(async (req, res) => {
  const body = [];
  for await (const chunk of req) body.push(chunk);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(body) });
  const response = await worker.fetch(request, process.env, {});
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`TACTICAL CONFIG → http://127.0.0.1:${port}`));
