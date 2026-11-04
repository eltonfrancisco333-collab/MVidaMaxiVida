import { createStateController } from '../controllers/stateController.js';
import { getHealth } from '../controllers/healthController.js';
import { sendJson } from '../utils/http.js';
import { createFirstRunController } from '../controllers/firstRunController.js';

export function createRouter(stateAccessService, firstRunService, options) {
  const stateController = createStateController(stateAccessService, firstRunService, options);
  const firstRunController = createFirstRunController(firstRunService);

  return async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
      return getHealth(request, response);
    }
    if (requestUrl.pathname === '/api/setup/status' && request.method === 'GET') {
      return firstRunController(request, response);
    }
    if (requestUrl.pathname === '/api/setup' && request.method === 'POST') {
      return firstRunController(request, response);
    }
    if (requestUrl.pathname === '/api/auth/login' && request.method === 'POST') {
      return firstRunController(request, response);
    }
    if (['/api/auth/logout', '/api/auth/change-password', '/api/users/password/reset', '/api/users/access'].includes(requestUrl.pathname)) {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método não permitido.' });
      return firstRunController(request, response);
    }
    if (requestUrl.pathname !== '/api/state') {
      return sendJson(response, 404, { error: 'Endereço não encontrado.' });
    }
    if (request.method === 'GET' || request.method === 'POST' || request.method === 'PUT') {
      return stateController(request, response);
    }
    return sendJson(response, 405, { error: 'Método não permitido.' });
  };
}
