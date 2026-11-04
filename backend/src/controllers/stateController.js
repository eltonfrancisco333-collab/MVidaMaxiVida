import { readJsonBody } from '../middlewares/readJsonBody.js';
import { sendJson } from '../utils/http.js';

export function createStateController(stateAccessService, firstRunService, { allowUnauthenticatedState = false } = {}) {
  return async (request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const user = allowUnauthenticatedState ? null : await firstRunService.assertPasswordChanged(token);
    if (request.method === 'GET') {
      const result = allowUnauthenticatedState
        ? await stateAccessService.stateService.getState()
        : await stateAccessService.getState(user);
      return sendJson(response, 200, result.state, {
        'Cache-Control': 'no-store',
        'X-MVida-Data-Source': result.persisted ? 'file' : 'seed'
      });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const state = await readJsonBody(request);
      if (!allowUnauthenticatedState && request.method === 'POST' && user.pf !== 'Administrador') {
        return sendJson(response, 403, { error: 'Apenas um administrador pode migrar os dados.' });
      }
      if (user?.pf === 'Administrador' || allowUnauthenticatedState) {
        await firstRunService.assertProtectedAdministratorRetained(state);
      }
      const saved = allowUnauthenticatedState
        ? await stateAccessService.stateService.saveState(state, { migration: request.method === 'POST' })
        : await stateAccessService.saveState(user, state, {
          migration: request.method === 'POST',
          ip: request.headers['x-forwarded-for']?.split(',')[0].trim() || request.socket.remoteAddress
        });
      const visible = user ? (await stateAccessService.getState(user)).state : saved;
      return sendJson(response, 200, visible);
    }
  };
}
