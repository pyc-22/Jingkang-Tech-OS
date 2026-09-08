const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const root = path.join(__dirname, 'apps', 'massage-console');
const address = process.env.MASSAGE_ADDRESS || '0.0.0.0';
const port = Number(process.env.MASSAGE_PORT || 5174);
const apiHost = process.env.MASSAGE_API_HOST || '127.0.0.1';
const apiPort = Number(process.env.MASSAGE_API_PORT || 8080);
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive'
};

http.createServer(async (req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (req.url.startsWith('/api/')) {
    const upstream = http.request({
      hostname: apiHost, port: apiPort, path: req.url, method: req.method,
      headers: { ...req.headers, host: `${apiHost}:${apiPort}` }
    }, upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{"message":"API service unavailable"}');
    });
    req.pipe(upstream);
    return;
  }
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname.replace(/^[/\\]+/, '');
  const safePath = requestPath ? path.normalize(requestPath).replace(/^([.][.][\\/])+/, '') : '';
  const filePath = path.join(root, safePath || 'index.html');
  if (!filePath.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(filePath);
    const headers = { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (path.extname(filePath) === '.apk') headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    res.writeHead(200, headers);
    res.end(body);
  }
  catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
}).listen(port, address, () => console.log(`Massage console: http://${address}:${port}`));
