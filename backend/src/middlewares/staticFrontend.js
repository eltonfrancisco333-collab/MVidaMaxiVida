import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sendJson } from '../utils/http.js';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

export async function serveFrontend(request, response, staticDirectory) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return sendJson(response, 405, { error: 'Método não permitido.' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    return sendJson(response, 400, { error: 'Endereço inválido.' });
  }

  const root = path.resolve(staticDirectory);
  const relativePath = pathname.replace(/^[/\\]+/, '').replace(/[\\/]+/g, path.sep);
  let filePath = path.resolve(root, relativePath || 'index.html');
  const rootPrefix = `${root}${path.sep}`.toLowerCase();
  if (filePath.toLowerCase() !== path.join(root, 'index.html').toLowerCase()
      && !filePath.toLowerCase().startsWith(rootPrefix)) {
    return sendJson(response, 400, { error: 'Endereço inválido.' });
  }

  let contents;
  try {
    contents = await readFile(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    filePath = path.join(root, 'index.html');
    try {
      contents = await readFile(filePath);
    } catch (indexError) {
      if (indexError.code !== 'ENOENT') throw indexError;
      return sendJson(response, 503, { error: 'Frontend não compilado. Execute npm run build.' });
    }
  }

  const filename = path.basename(filePath);
  const immutable = /-[A-Za-z0-9]{8,}\./.test(filename);
  response.writeHead(200, {
    'Content-Type': contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Length': contents.length
  });
  if (request.method === 'HEAD') return response.end();
  return response.end(contents);
}
