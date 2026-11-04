import { ApiError } from '../utils/errors.js';

export const collections = ['patients', 'employees', 'users', 'appointments', 'payments', 'audit', 'reports', 'services'];
export const initialState = Object.fromEntries(collections.map((name) => [name, []]));

const generatedPatientIdentifier = /^PTC-(\d+)$/i;
const corruptPatientIdentifier = /^PTC-(?:-?Infinity|NaN|undefined|null)$/i;

function nextPatientIdentifier(sequence, used) {
  let next = sequence;
  let identifier;
  do {
    next += 1n;
    identifier = `PTC-${next.toString().padStart(3, '0')}`;
  } while (used.has(identifier.toLocaleLowerCase()));
  return { identifier, sequence: next };
}

export function repairPatientIdentifiers(state) {
  const used = new Set();
  let sequence = 0n;
  for (const patient of state.patients) {
    const value = typeof patient.p === 'string' ? patient.p.trim() : '';
    const match = value.match(generatedPatientIdentifier);
    if (match) {
      const current = BigInt(match[1]);
      if (current > sequence) sequence = current;
    }
  }

  let changed = false;
  for (const patient of state.patients) {
    const value = typeof patient.p === 'string' ? patient.p.trim() : '';
    const key = value.toLocaleLowerCase();
    if (!value || corruptPatientIdentifier.test(value) || used.has(key)) {
      const generated = nextPatientIdentifier(sequence, used);
      patient.p = generated.identifier;
      sequence = generated.sequence;
      used.add(patient.p.toLocaleLowerCase());
      changed = true;
      continue;
    }
    if (patient.p !== value) {
      patient.p = value;
      changed = true;
    }
    used.add(key);
  }
  return changed;
}

export function assignNewPatientIdentifiers(currentPatients, nextPatients) {
  const currentByIdentifier = new Map(currentPatients
    .filter((patient) => typeof patient.p === 'string' && patient.p.trim())
    .map((patient) => [patient.p.trim().toLocaleLowerCase(), patient]));
  const assigned = new Set();
  const used = new Set(currentByIdentifier.keys());
  let sequence = 0n;
  for (const patient of currentPatients) {
    const match = typeof patient.p === 'string' ? patient.p.trim().match(generatedPatientIdentifier) : null;
    if (match) {
      const current = BigInt(match[1]);
      if (current > sequence) sequence = current;
    }
  }

  for (const patient of nextPatients) {
    const key = typeof patient.p === 'string' ? patient.p.trim().toLocaleLowerCase() : '';
    const previous = currentByIdentifier.get(key);
    if (previous && !assigned.has(previous)) {
      patient.p = previous.p;
      assigned.add(previous);
      continue;
    }
    const generated = nextPatientIdentifier(sequence, used);
    patient.p = generated.identifier;
    sequence = generated.sequence;
    used.add(patient.p.toLocaleLowerCase());
  }
}

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
