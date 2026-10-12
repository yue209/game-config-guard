import worker from '../worker/index.js';

const ROUTES = new Set(['status', 'check', 'apply', 'preview']);

export default async function handler(req, res) {
  const incoming = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const route = incoming.searchParams.get('__route') || 'root';
  const pathname = route === 'root' ? '/' : ROUTES.has(route) ? `/api/${route}` : '/404';
  const target = new URL(pathname, `https://${req.headers.host || 'localhost'}`);

  for (const [key, value] of incoming.searchParams) {
    if (key !== '__route') target.searchParams.append(key, value);
  }

  const chunks = [];
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    for await (const chunk of req) chunks.push(chunk);
  }

  const request = new Request(target, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const response = await worker.fetch(request, process.env, {});

  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
