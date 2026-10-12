import http from 'node:http';
import worker from '../worker/index.js';
const port = Number(process.env.PORT || 8788);
http.createServer(async (req, res) => {
  const body = [];
  for await (const chunk of req) body.push(chunk);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(body) });
  const response = await worker.fetch(request, process.env, {});
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`TACTICAL CONFIG → http://127.0.0.1:${port}`));
