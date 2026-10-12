import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import handler from '../api/entry.js';

async function invoke({ route, method = 'GET', body }) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  req.method = method;
  req.url = `/?__route=${route}`;
  req.headers = { host: 'localhost', 'content-type': 'application/json' };

  const headers = {};
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader(key, value) { headers[key] = value; },
    end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); },
  };
  await handler(req, res);
  return { status: res.statusCode, headers, text: Buffer.concat(chunks).toString('utf8') };
}

test('Vercel adapter serves the application shell', async () => {
  const response = await invoke({ route: 'root' });
  assert.equal(response.status, 200);
  assert.match(response.text, /TACTICAL CONFIG/);
});

test('Vercel adapter exposes model status without leaking secrets', async () => {
  const response = await invoke({ route: 'status' });
  assert.equal(response.status, 200);
  const data = JSON.parse(response.text);
  assert.equal(data.model, 'qwen-plus');
  assert.equal('DASHSCOPE_API_KEY' in data, false);
});
