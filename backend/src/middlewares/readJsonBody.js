import { ApiError } from '../utils/errors.js';

const maximumRequestBytes = 2 * 1024 * 1024;

export async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumRequestBytes) throw new ApiError(413, 'O pedido excede o tamanho permitido.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'O corpo do pedido não contém JSON válido.');
  }
}
