import { readJsonBody } from '../middlewares/readJsonBody.js';
import { sendJson } from '../utils/http.js';

export function createStateController(stateService, firstRunService) {
  return async (request, response) => {
    if (request.method === 'GET') {
      const result = await stateService.getState();
      return sendJson(response, 200, result.state, {
        'X-MVida-Data-Source': result.persisted ? 'file' : 'seed'
      });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const state = await readJsonBody(request);
      await firstRunService.assertProtectedAdministratorRetained(state);
      const saved = await stateService.saveState(state, { migration: request.method === 'POST' });
      return sendJson(response, 200, saved);
    }
  };
}
