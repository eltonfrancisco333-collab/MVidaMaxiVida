import { sendJson } from '../utils/http.js';

export function getHealth(_request, response) {
  return sendJson(response, 200, { status: 'ok' });
}
