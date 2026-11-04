import { readJsonBody } from '../middlewares/readJsonBody.js';
import { sendJson } from '../utils/http.js';

export function createFirstRunController(firstRunService) {
  return async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (requestUrl.pathname === '/api/auth/logout') {
      await firstRunService.logout(token);
      return sendJson(response, 200, { success: true });
    }
    if (requestUrl.pathname === '/api/users/password/reset') {
      await firstRunService.assertPasswordChanged(token);
      const input = await readJsonBody(request);
      const result = await firstRunService.resetUserPassword(token, input);
      return sendJson(response, 200, result);
    }
    if (requestUrl.pathname === '/api/users/access') {
      await firstRunService.assertPasswordChanged(token);
      const input = await readJsonBody(request);
      const user = await firstRunService.updateUserAccess(token, input);
      return sendJson(response, 200, { user });
    }
    if (requestUrl.pathname === '/api/auth/change-password') {
      const input = await readJsonBody(request);
      const result = await firstRunService.changePassword(token, input);
      return sendJson(response, 200, result);
    }
    if (requestUrl.pathname === '/api/setup/status') {
      return sendJson(response, 200, await firstRunService.getSetupStatus());
    }
    const input = await readJsonBody(request);
    if (requestUrl.pathname === '/api/setup') {
      const user = await firstRunService.createAdministrator(input);
      return sendJson(response, 201, user);
    }
    const result = await firstRunService.authenticate(input);
    return sendJson(response, 200, result);
  };
}
