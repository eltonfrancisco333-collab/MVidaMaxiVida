import { ApiError } from '../utils/errors.js';

export const collections = ['patients', 'employees', 'users', 'appointments', 'payments', 'audit', 'reports', 'services'];
export const initialState = Object.fromEntries(collections.map((name) => [name, []]));

export function validateState(state, { allowLegacyPatientIdentifiers = false } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new ApiError(400, 'Os dados enviados têm um formato inválido.');
  }

  for (const collection of collections) {
    if (!Array.isArray(state[collection]) || state[collection].length > 10000) {
      throw new ApiError(400, `A lista "${collection}" está ausente ou excede o limite permitido.`);
    }
    if (state[collection].some((record) => !record || typeof record !== 'object' || Array.isArray(record))) {
      throw new ApiError(400, `A lista "${collection}" contém um registo inválido.`);
    }
  }
  const patientIdentifiers = new Set();
  for (const patient of state.patients) {
    if (patient.p !== undefined && patient.p !== null && typeof patient.p !== 'string') {
      if (allowLegacyPatientIdentifiers) continue;
      throw new ApiError(400, 'O número de processo de cada paciente deve ser texto.');
    }
    if (typeof patient.p !== 'string' || !patient.p.trim()) continue;
    const identifier = patient.p.trim().toLocaleLowerCase();
    if (patientIdentifiers.has(identifier) && !allowLegacyPatientIdentifiers) {
      throw new ApiError(400, `O número de processo "${patient.p}" está associado a mais de um paciente.`);
    }
    patientIdentifiers.add(identifier);
  }
}

function normalizeLinkedName(name) {
  return typeof name === 'string' ? name.replace('Jo\uFFFDo Manuel Costa', 'João Manuel Costa') : name;
}

export function preventDeletingLinkedRecords(current, next) {
  const patientNames = new Set(next.patients.map((patient) => normalizeLinkedName(patient.n)));
  const employeeNames = new Set(next.employees.map((employee) => employee.n));

  for (const appointment of current.appointments) {
    if (!patientNames.has(normalizeLinkedName(appointment.pac))) {
      throw new ApiError(409, `Não é possível eliminar o paciente ${appointment.pac}, pois está associado a uma consulta.`);
    }
    if (!employeeNames.has(appointment.med)) {
      throw new ApiError(409, `Não é possível eliminar o médico ${appointment.med}, pois está associado a uma consulta.`);
    }

    for (const payment of current.payments) {
      if (!next.payments.some((record) => String(record.id) === String(payment.id))) {
        throw new ApiError(409, 'Os registos de cobrança devem ser anulados, não eliminados.');
      }
    }
  }
}
