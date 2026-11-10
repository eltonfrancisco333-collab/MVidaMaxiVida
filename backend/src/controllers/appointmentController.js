import { readJsonBody } from '../middlewares/readJsonBody.js';
import { ApiError } from '../utils/errors.js';
import { sendJson } from '../utils/http.js';
import { getSessionToken } from '../utils/auth.js';

export function createAppointmentController(stateAccessService, firstRunService) {
  return async (request, response) => {
    const token = getSessionToken(request);
    const user = await firstRunService.assertPasswordChanged(token);
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((field) => !['appointmentId', 'clinicalNote'].includes(field))
      || !['string', 'number'].includes(typeof body.appointmentId)
      || !String(body.appointmentId).trim()
      || typeof body.clinicalNote !== 'string') {
      throw new ApiError(400, 'Os dados para concluir a consulta são inválidos.');
    }

    await stateAccessService.completeAppointment(user, String(body.appointmentId), body.clinicalNote, {
      ip: request.headers['x-forwarded-for']?.split(',')[0].trim() || request.socket.remoteAddress
    });
    const { state } = await stateAccessService.getState(user);
    return sendJson(response, 200, state);
  };
}
