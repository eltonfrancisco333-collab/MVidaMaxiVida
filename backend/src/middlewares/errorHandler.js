import { ApiError } from '../utils/errors.js';
import { sendJson } from '../utils/http.js';

export function handleApiError(response, error) {
  if (error instanceof ApiError) {
    return sendJson(response, error.status, { error: error.message });
  }
  console.error('Falha ao processar pedido da API:', error.message);
  if (!response.headersSent) return sendJson(response, 500, { error: 'Erro interno ao processar o pedido.' });
  response.destroy();
}
