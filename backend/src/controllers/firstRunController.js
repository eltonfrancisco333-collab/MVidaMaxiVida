import { readJsonBody } from '../middlewares/readJsonBody.js';
import { sendJson } from '../utils/http.js';
import { expiredSessionCookie, getSessionToken, sessionCookie } from '../utils/auth.js';
import { ApiError } from '../utils/errors.js';

export function createFirstRunController(firstRunService) {
  return async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const token = getSessionToken(request);
    if (requestUrl.pathname === '/api/auth/logout') {
      await firstRunService.logout(token);
      return sendJson(response, 200, { success: true }, { 'Set-Cookie': expiredSessionCookie(request) });
    }
    if (requestUrl.pathname === '/api/auth/session') {
      try {
        const session = await firstRunService.getCurrentSession(token);
        return sendJson(response, 200, session);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        return sendJson(response, 401, { error: error.message }, { 'Set-Cookie': expiredSessionCookie(request) });
      }
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
      return sendJson(response, 200, result, { 'Set-Cookie': sessionCookie(request, result.token) });
    }
    if (requestUrl.pathname === '/api/setup/status') {
      return sendJson(response, 200, await firstRunService.getSetupStatus());
    }
    const input = await readJsonBody(request);
    if (requestUrl.pathname === '/api/setup') {
      const user = await firstRunService.createAdministrator(input);
      return sendJson(response, 201, user, { 'Set-Cookie': sessionCookie(request, user.token) });
    }
    const forwardedHeader = request.headers['x-forwarded-for'];
    const forwardedAddresses = typeof forwardedHeader === 'string'
      ? forwardedHeader.split(',').map((address) => address.trim()).filter(Boolean)
      : [];
    const clientAddress = forwardedAddresses?.at(-1) || request.socket.remoteAddress || 'unknown';
    const result = await firstRunService.authenticate(input, { clientAddress });
    return sendJson(response, 200, result, { 'Set-Cookie': sessionCookie(request, result.token) });
  };
}
