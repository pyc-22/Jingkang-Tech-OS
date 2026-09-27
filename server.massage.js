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
    const extension = path.extname(filePath).toLowerCase();
    const stats = await fs.stat(filePath);
    const body = req.method === 'HEAD' ? null : await fs.readFile(filePath);
    const versionedAsset = /[?&](?:v|hash|version)=[^&]+/i.test(req.url);
    const cacheControl = extension === '.apk'
      ? 'no-store'
      : path.basename(filePath).toLowerCase() === 'index.html'
      ? 'no-cache, no-store, must-revalidate'
      : ['.js', '.css'].includes(extension) && versionedAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
    const etag = `"${Math.floor(stats.mtimeMs).toString(16)}-${stats.size.toString(16)}"`;
    const lastModified = stats.mtime.toUTCString();
    const lastModifiedMs = Math.floor(stats.mtimeMs / 1000) * 1000;
    const headers = {
      'Content-Type': mime[extension] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': lastModified
    };
    const notModified = req.headers['if-none-match'] === etag ||
      (!req.headers['if-none-match'] && req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']).getTime() >= lastModifiedMs);
    if (notModified) {
      delete headers['Content-Length'];
      res.writeHead(304, headers);
      res.end();
      return;
    }
    if (extension === '.apk') headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    res.writeHead(200, headers);
    if (body) res.end(body); else res.end();
  }
  catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
}).listen(port, address, () => console.log(`Massage console: http://${address}:${port}`));
