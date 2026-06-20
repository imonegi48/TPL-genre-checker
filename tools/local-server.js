const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
  const requestPath = decodeURIComponent(requestUrl.pathname);

  const relativePath = requestPath === '/'
    ? 'index.html'
    : requestPath.replace(/^\/+/, '');

  const filePath = path.join(ROOT_DIR, relativePath);

  if(!filePath.startsWith(ROOT_DIR)){
    res.writeHead(403, {
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if(err){
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8'
      });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream'
    });

    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`ローカルサーバーを起動しました`);
  console.log(`http://localhost:${PORT}/`);
});