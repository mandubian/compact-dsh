// The local releases host — the run's publish target, bound on the
// mediation network's gateway (all-local delivery under the declared
// private-class exception, #55). Lives in its own module so a test can
// hold it to its contract: a PUT stores; a GET returns WHAT WAS STORED —
// byte for byte — so a member that verifies its own publish (fetch back,
// hash both sides) sees the truth. The live run's publisher caught the
// first version answering a GET with the PUT's JSON receipt: a receiver
// that pretends teaches the community that verification fails.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

export function createReleasesHost(bindAddress) {
  const uploads = [];
  const stored = new Map(); // path -> { body, sha256, at }
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bytes = Buffer.concat(chunks);
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (req.method === 'PUT' || req.method === 'POST') {
        stored.set(req.url, { body: bytes, sha256: sha, at: new Date().toISOString() });
        uploads.push({ method: req.method, path: req.url, bytes: bytes.length, sha256: sha, at: new Date().toISOString() });
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received: req.url, bytes: bytes.length, sha256: sha }) + '\n');
        return;
      }
      const hit = stored.get(req.url);
      if (hit) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': hit.body.length });
        res.end(hit.body);
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', path: req.url }) + '\n');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, bindAddress, () => {
      const { port } = server.address();
      resolve({
        server, port, host: bindAddress,
        origin: `http://${bindAddress}:${port}`,
        uploads,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
