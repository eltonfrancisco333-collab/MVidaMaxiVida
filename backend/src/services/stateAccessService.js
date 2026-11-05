import { randomBytes } from 'node:crypto';
import { ApiError } from '../utils/errors.js';
import { assignNewPatientIdentifiers, collections, validateState } from '../domain/state.js';

const profiles = ['Administrador', 'Recepção', 'Médico', 'Financeiro'];
const baseCollectionAccess = {
  Administrador: new Set(collections),
  Recepção: new Set(['patients', 'employees', 'appointments', 'payments', 'services']),
  Médico: new Set(['patients', 'employees', 'appointments']),
  Financeiro: new Set(['patients', 'employees', 'appointments', 'payments'])
};
const editableCollections = {
  Administrador: new Set(collections),
  Recepção: new Set(['patients', 'appointments', 'payments']),
  Médico: new Set(['appointments']),
  Financeiro: new Set()
};

const copy = (value) => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const byName = (records, name) => records.find((record) => record.n === name);
const patientReferenceFields = ['n', 'p', 't', 'ta', 'e', 'bi', 'nc', 'ca', 'st'];
const clinicDayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const consultationPriceFor = (doctor, services) => {
  const consultationServices = services.filter((candidate) => candidate.name.trim().toLowerCase() === 'consulta'
    && candidate.specialty === doctor?.s);
  const service = consultationServices.find((candidate) => candidate.active !== false) || consultationServices[0];
  if (!service) return 0;
  if (service.active === false) return 0;
  return Number(service.price) || 0;
};

function clinicDateTime() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function validateAppointmentSchedule(currentAppointments, nextAppointments, employees, services) {
  const { date: today, time: now } = clinicDateTime();
  for (const appointment of nextAppointments) {
    const previous = currentAppointments.find((candidate) => candidate.id === appointment.id);
    if (appointment.mo !== undefined && (typeof appointment.mo !== 'string' || appointment.mo.length > 500)) {
      throw new ApiError(400, 'O motivo da consulta deve ter no máximo 500 caracteres.');
    }
    if (previous && previous.d === appointment.d && previous.h === appointment.h && previous.med === appointment.med) continue;

    const appointmentDate = new Date(`${appointment.d}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment.d || '')
      || Number.isNaN(appointmentDate.getTime())
      || appointmentDate.toISOString().slice(0, 10) !== appointment.d
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(appointment.h || '')) {
      throw new ApiError(400, 'Indique uma data e uma hora válidas para a consulta.');
    }
    if (appointment.d < today || (appointment.d === today && appointment.h <= now)) {
      throw new ApiError(400, 'Só é possível agendar consultas para um horário futuro.');
    }

    const employee = byName(employees, appointment.med);
    if (!employee || employee.f !== 'Médico' || employee.st !== 'Activo') {
      throw new ApiError(400, 'Seleccione um médico activo para a consulta.');
    }
    if (!previous) {
      const expectedPrice = consultationPriceFor(employee, services);
      if (!Number.isSafeInteger(expectedPrice) || expectedPrice <= 0) {
        const consultation = services.find((candidate) => candidate.name.trim().toLowerCase() === 'consulta'
          && candidate.specialty === employee.s);
        if (consultation?.active === false) {
          throw new ApiError(400, 'A consulta desta especialidade está desactivada. Active o preço na tela Serviços.');
        }
        throw new ApiError(400, 'Defina o preço da consulta na tela Serviços.');
      }
      if (Number(appointment.v) !== expectedPrice) {
        throw new ApiError(400, 'O preço da consulta não corresponde ao preço configurado para a especialidade.');
      }
    }
    const schedule = Array.isArray(employee.h)
      ? employee.h.find((entry) => Array.isArray(entry) && entry[0] === clinicDayNames[appointmentDate.getUTCDay()])
      : undefined;
    if (!schedule || typeof schedule[1] !== 'string' || typeof schedule[2] !== 'string'
      || !/^\d{2}:\d{2}$/.test(schedule[1]) || !/^\d{2}:\d{2}$/.test(schedule[2])) {
      throw new ApiError(400, 'O médico não tem horário de atendimento nesse dia.');
    }
    const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const appointmentMinutes = minutes(appointment.h);
    const start = minutes(schedule[1]);
    const end = minutes(schedule[2]);
    if (appointmentMinutes < start || appointmentMinutes >= end || (appointmentMinutes - start) % 30 !== 0) {
      throw new ApiError(400, 'Escolha um horário disponível dentro do horário de atendimento do médico.');
    }
    if (nextAppointments.some((candidate) => candidate.id !== appointment.id
      && candidate.med === appointment.med && candidate.d === appointment.d && candidate.h === appointment.h
      && candidate.st !== 'Cancelada')) {
      throw new ApiError(409, 'O médico já tem uma consulta nesse horário.');
    }
  }
}

function projectPatient(patient, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(patient, field)).map((field) => [field, patient[field]]));
}

function roleView(state, user) {
  if (user.pf === 'Administrador') return copy(state);

  const view = Object.fromEntries(collections.map((name) => [name, []]));
  view._revision = state._revision;
  if (user.pf === 'Recepção') {
    view.patients = state.patients.map((patient) => ({
      ...projectPatient(patient, patientReferenceFields),
      al: '',
      tb: ''
    }));
    view.employees = state.employees.map((employee) => projectPatient(employee, ['n', 'f', 's', 'st', 'h', 'p']));
    view.appointments = state.appointments.map(({ mo, clinicalNote, ...appointment }) => ({
      ...appointment,
      mo: '',
      clinicalNote: ''
    }));
    view.payments = copy(state.payments);
    view.services = copy(state.services);
  } else if (user.pf === 'Médico') {
    const employee = byName(state.employees, user.n);
    if (!employee || employee.f !== 'Médico') throw new ApiError(403, 'A conta não está associada a um médico.');
    view.employees = [copy(employee)];
    view.appointments = state.appointments
      .filter((appointment) => appointment.med === user.n)
      .map(copy);
    const patientNames = new Set(view.appointments.map((appointment) => appointment.pac));
    view.patients = state.patients.filter((patient) => patientNames.has(patient.n)).map(copy);
  } else if (user.pf === 'Financeiro') {
    view.patients = state.patients.map((patient) => projectPatient(patient, ['n', 'p', 't', 'e', 'st']));
    view.employees = state.employees.map((employee) => projectPatient(employee, ['n', 'f', 's', 'st']));
    view.appointments = state.appointments.map(({ mo, clinicalNote, ...appointment }) => ({
      ...appointment,
      mo: '',
      clinicalNote: ''
    }));
    view.payments = copy(state.payments);
  } else {
    throw new ApiError(403, 'O perfil da conta não tem acesso aos dados do sistema.');
  }
  return view;
}

function enforceCollectionAccess(current, next, user) {
  const readable = baseCollectionAccess[user.pf];
  const editable = editableCollections[user.pf];
  if (!readable || !editable) throw new ApiError(403, 'O perfil da conta não tem acesso aos dados do sistema.');

  const visible = roleView(current, user);
  for (const collection of collections) {
    if (editable.has(collection)) continue;
    if (!same(next[collection], visible[collection])) {
      throw new ApiError(403, `O perfil ${user.pf} não pode alterar a lista "${collection}".`);
    }
  }

  for (const collection of collections) {
    if (!readable.has(collection) && next[collection].length) {
      throw new ApiError(403, `O perfil ${user.pf} não pode aceder à lista "${collection}".`);
    }
  }
}

function mergeReceptionPatients(currentPatients, submittedPatients) {
  const patientKey = (patient) => typeof patient.p === 'string' && patient.p.trim()
    ? `id:${patient.p.trim().toLocaleLowerCase()}`
    : `name:${String(patient.n || '').trim().toLocaleLowerCase()}`;
  const assertUniquePatientKeys = (patients) => {
    const keys = new Set();
    for (const patient of patients) {
      const key = patientKey(patient);
      if (keys.has(key)) {
        throw new ApiError(409, 'Existem pacientes com identificadores repetidos. Corrija os números de processo antes de guardar.');
      }
      keys.add(key);
    }
  };
  assertUniquePatientKeys(currentPatients);
  assertUniquePatientKeys(submittedPatients);
  if (currentPatients.some((patient) => !submittedPatients.some((next) => patientKey(next) === patientKey(patient)))) {
    throw new ApiError(403, 'A recepção não pode eliminar pacientes; peça ao administrador para os desactivar.');
  }
  const previous = new Map(currentPatients.map((patient) => [patientKey(patient), patient]));
  const merged = submittedPatients.map((patient) => {
    const old = previous.get(patientKey(patient));
    if (!old) {
      if (Object.keys(patient).some((key) => !patientReferenceFields.includes(key) && !['al', 'tb'].includes(key))
        || (patient.al && patient.al !== 'Não registadas')
        || patient.tb) {
        throw new ApiError(403, 'A recepção não pode registar informação clínica.');
      }
      return { ...patient, al: '', tb: '' };
    }
    if ((patient.al && patient.al !== 'Não registadas') || patient.tb) {
      throw new ApiError(403, 'A recepção não pode alterar informação clínica do paciente.');
    }
    for (const key of Object.keys(patient)) {
      if (!patientReferenceFields.includes(key) && !['al', 'tb'].includes(key) && !same(patient[key], old[key])) {
        throw new ApiError(403, 'A recepção não pode alterar informação clínica do paciente.');
      }
    }
    return { ...old, ...patient, al: old.al, tb: old.tb };
  });
  return merged;
}

function mergeReceptionAppointments(currentAppointments, submittedAppointments, state) {
  const oldById = new Map(currentAppointments.map((appointment) => [appointment.id, appointment]));
  for (const appointment of submittedAppointments) {
    const editableFields = new Set(['id', 'd', 'h', 'pac', 'med', 'esp', 'st', 'v', 'mo', 'clinicalNote', 'rescheduleHistory']);
    if (Object.keys(appointment).some((field) => !editableFields.has(field))) {
      throw new ApiError(403, 'A recepção não pode alterar campos internos da consulta.');
    }
    const old = oldById.get(appointment.id);
    if (old) {
      if (old.st !== 'Agendada'
        && (appointment.d !== old.d || appointment.h !== old.h || appointment.st !== old.st)) {
        throw new ApiError(409, 'Só é possível reagendar ou cancelar uma consulta ainda agendada.');
      }
      if (appointment.mo || appointment.clinicalNote) {
        throw new ApiError(403, 'A recepção não pode alterar notas clínicas.');
      }
      if (['d', 'h'].some((field) => appointment[field] !== old[field])) {
        const charge = state.payments.find((payment) => payment.appointmentId === old.id);
        if (charge?.st === 'Pago') {
          throw new ApiError(409, 'Uma consulta paga só pode ser remarcada depois do estorno integral.');
        }
        appointment.rescheduleHistory = [
          ...(old.rescheduleHistory || []),
          { d: old.d, h: old.h, changedAt: new Date().toISOString().slice(0, 10) }
        ];
      } else {
        appointment.rescheduleHistory = old.rescheduleHistory || [];
      }
      appointment.mo = old.mo;
      if (old.clinicalNote !== undefined) appointment.clinicalNote = old.clinicalNote;
      appointment.v = old.v;
      if (old.st !== appointment.st && !['Agendada', 'Cancelada', 'Faltou'].includes(appointment.st)) {
        throw new ApiError(403, 'A recepção só pode agendar, cancelar ou registar uma falta.');
      }
      if (old.st !== 'Agendada' && old.st !== appointment.st) {
        throw new ApiError(409, 'Só é possível alterar o estado de uma consulta ainda agendada.');
      }
    } else {
      if (!appointment.id || appointment.st !== 'Agendada') {
        throw new ApiError(400, 'Uma nova consulta deve começar com o estado Agendada.');
      }
      const doctor = byName(state.employees, appointment.med);
      appointment.v = consultationPriceFor(doctor, state.services);
      appointment.clinicalNote = '';
      appointment.rescheduleHistory = [];
    }
  }
  if (currentAppointments.some((appointment) => !submittedAppointments.some((next) => next.id === appointment.id))) {
    throw new ApiError(409, 'As consultas não podem ser eliminadas; cancele ou marque a falta para preservar o histórico.');
  }
  validateAppointmentSchedule(currentAppointments, submittedAppointments, state.employees, state.services);
  return submittedAppointments;
}

function mergeDoctorAppointments(currentAppointments, submittedAppointments, user) {
  const oldById = new Map(currentAppointments.map((appointment) => [appointment.id, appointment]));
  for (const appointment of submittedAppointments) {
    if (Object.keys(appointment).some((field) => !['id', 'd', 'h', 'pac', 'med', 'esp', 'st', 'v', 'mo', 'clinicalNote', 'rescheduleHistory'].includes(field))) {
      throw new ApiError(403, 'O perfil médico não pode alterar campos internos da consulta.');
    }
    if (appointment.med !== user.n) throw new ApiError(403, 'Só pode alterar as consultas que lhe estão atribuídas.');
    const old = oldById.get(appointment.id);
    if (!old || appointment.pac !== old.pac || appointment.med !== old.med) {
      throw new ApiError(403, 'O perfil médico não pode criar, reatribuir nem eliminar consultas.');
    }
    const unchangedFields = ['d', 'h', 'pac', 'med', 'esp', 'v', 'id', 'mo'];
    if (unchangedFields.some((field) => !same(appointment[field], old[field]))) {
      throw new ApiError(403, 'O perfil médico só pode actualizar o estado clínico da consulta.');
    }
    if (!['Agendada', 'Em curso', 'Concluída', 'Cancelada', 'Faltou'].includes(appointment.st)) {
      throw new ApiError(400, 'Estado de consulta inválido.');
    }
    const allowedTransitions = {
      Agendada: ['Agendada', 'Em curso', 'Concluída', 'Cancelada'],
      'Em curso': ['Em curso', 'Concluída', 'Cancelada'],
      'Concluída': ['Concluída'],
      Cancelada: ['Cancelada'],
      Faltou: ['Faltou']
    };
    if (!allowedTransitions[old.st]?.includes(appointment.st)) {
      throw new ApiError(409, 'Transição de estado da consulta inválida.');
    }
    if (appointment.st === 'Concluída' && appointment.clinicalNote !== old.clinicalNote
      && String(appointment.clinicalNote || '').trim().length < 3) {
      throw new ApiError(400, 'Registe o diagnóstico antes de concluir a consulta.');
    }
    if (appointment.st === 'Concluída' && !String(appointment.clinicalNote || '').trim()) {
      throw new ApiError(400, 'Registe o diagnóstico antes de concluir a consulta.');
    }
    if (appointment.clinicalNote !== old.clinicalNote
      && (!['Agendada', 'Em curso'].includes(old.st) || appointment.st !== 'Concluída')) {
      throw new ApiError(403, 'O diagnóstico só pode ser registado ao concluir a consulta.');
    }
  }
  if (currentAppointments.some((appointment) => appointment.med === user.n
    && !submittedAppointments.some((next) => next.id === appointment.id))) {
    throw new ApiError(403, 'O perfil médico não pode eliminar consultas.');
  }
  return submittedAppointments;
}

const paymentFields = [
  'id', 'appointmentId', 'kind', 'd', 'pac', 'ds', 'v', 'st', 'm', 'med', 'serviceId',
  'paidAt', 'refundReason', 'refundedAt', 'refundRequired', 'refundMethod', 'refundReference',
  'refundConfirmed', 'refundedBy', 'voidReason', 'voidConfirmed', 'paymentDetails', 'receiptNumber',
  'observations', 'registeredBy', 'registeredAt', 'voidedBy', 'voidedAt'
];
const letterCount = (value) => [...String(value || '').matchAll(/\p{L}/gu)].length;
const validIsoDate = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const paymentDetailIsValid = (method, details) => {
  const value = String(details || '').trim();
  if (method === 'Dinheiro') return !value;
  if (method === 'Cartão') return /^\d{4}$/.test(value);
  if (method === 'Transferência') return value.length > 0 && value.length <= 80;
  if (method === 'Pagamento móvel') return /^(84|85)\d{7}$/.test(value);
  return false;
};
const createReceiptNumber = (payments) => {
  let number;
  do {
    number = `DIN${randomBytes(7).toString('hex').toUpperCase()}`;
  } while (payments.some((payment) => payment.receiptNumber === number));
  return number;
};

function enforceFinancialLedger(currentPayments, submittedPayments, currentState, nextState, user, allowConsultationCreation = false) {
  const oldById = new Map(currentPayments.map((payment) => [String(payment.id), payment]));
  const paymentIds = new Set();
  const appointmentCharges = new Set();
  for (const payment of submittedPayments) {
    const id = String(payment.id);
    if (paymentIds.has(id)) throw new ApiError(400, 'Os identificadores das cobranças devem ser únicos.');
    paymentIds.add(id);
    if (payment.kind === 'Consulta' && payment.appointmentId && payment.st !== 'Anulado') {
      if (appointmentCharges.has(payment.appointmentId)) {
        throw new ApiError(409, 'Uma consulta só pode ter uma cobrança associada.');
      }
      appointmentCharges.add(payment.appointmentId);
    }
  }
  for (const payment of currentPayments) {
    if (!submittedPayments.some((next) => String(next.id) === String(payment.id))) {
      throw new ApiError(409, 'Os registos de cobrança não podem ser eliminados; anule-os para preservar o histórico.');
    }
  }
  for (const payment of submittedPayments) {
    const previous = oldById.get(String(payment.id));
    if (previous) {
      if (Object.keys(payment).some((field) => ![
        ...paymentFields
      ].includes(field))) {
        throw new ApiError(400, 'A cobrança contém campos inválidos.');
      }
      const appointment = payment.appointmentId
        ? nextState.appointments.find((candidate) => candidate.id === payment.appointmentId)
        : null;
      const previousAppointment = currentState.appointments.find((candidate) => candidate.id === appointment?.id);
      const linkedLegacyCharge = !previous.appointmentId
        && payment.kind === 'Consulta'
        && appointment
        && appointment.pac === previous.pac
        && appointment.med === previous.med
        && appointment.d === previous.d
        && /consulta/i.test(previous.ds || '')
        && currentPayments.filter((candidate) => candidate.pac === previous.pac
          && candidate.med === previous.med && candidate.d === previous.d && /consulta/i.test(candidate.ds || '')).length === 1;
      const synchronizedPendingConsultation = previous.kind === 'Consulta'
        && previous.st === 'Pendente'
        && payment.st === 'Pendente'
        && appointment
        && (!previousAppointment || !same(previousAppointment, appointment));
      for (const field of ['kind', 'appointmentId', 'd', 'pac', 'ds', 'v', 'med', 'serviceId']) {
        const synchronizedField = (linkedLegacyCharge && ['kind', 'appointmentId'].includes(field))
          || (synchronizedPendingConsultation && ['d', 'pac', 'ds', 'v', 'med'].includes(field));
        if (!synchronizedField && !same(payment[field], previous[field])) {
          throw new ApiError(403, 'Não é permitido alterar a origem nem o valor de uma cobrança existente.');
        }
      }
      if (synchronizedPendingConsultation
        && (payment.d !== appointment.d || payment.pac !== appointment.pac
          || payment.ds !== `Consulta · ${appointment.esp}` || payment.v !== Number(appointment.v)
          || payment.med !== appointment.med)) {
        throw new ApiError(400, 'A cobrança pendente não corresponde à consulta actualizada.');
      }
      if (['Anulado', 'Estornado'].includes(previous.st) && payment.st !== previous.st) {
        throw new ApiError(409, 'Uma cobrança anulada ou estornada não pode ser reactivada.');
      }
      if (previous.st === 'Pago' && payment.st === 'Pendente') {
        throw new ApiError(409, 'Um pagamento concluído não pode voltar a pendente.');
      }
      if (!['Pendente', 'Pago', 'Anulado', 'Estornado'].includes(payment.st)) {
        throw new ApiError(400, 'Estado de pagamento inválido.');
      }
      if (previous.st === 'Pendente' && payment.st === 'Pendente'
        && (payment.m !== previous.m || !same(payment.paidAt, previous.paidAt)
          || payment.paymentDetails !== previous.paymentDetails
          || payment.receiptNumber !== previous.receiptNumber
          || payment.registeredBy !== previous.registeredBy
          || payment.registeredAt !== previous.registeredAt
          || payment.observations !== previous.observations)) {
        throw new ApiError(403, 'Os dados do pagamento só podem ser registados ao concluir a cobrança.');
      }
      if (['Anulado', 'Estornado'].includes(previous.st) && !same(payment, previous)) {
        throw new ApiError(409, 'Uma cobrança anulada ou estornada não pode ser alterada.');
      }
      if (previous.st === 'Pago' && payment.st === 'Pago') {
        const changedFields = paymentFields.filter((field) => field !== 'observations'
          && !same(payment[field], previous[field]));
        if (changedFields.length) {
          throw new ApiError(403, 'Um pagamento concluído é imutável; apenas as observações podem ser alteradas.');
        }
      }
      if (previous.st === 'Pago' && payment.st === 'Anulado') {
        if (user.pf !== 'Administrador') {
          throw new ApiError(403, 'Só o administrador pode anular um pagamento concluído.');
        }
        if (payment.voidConfirmed !== true) {
          throw new ApiError(400, 'Confirme que está a corrigir um registo inválido e não a devolver dinheiro.');
        }
        if (letterCount(payment.voidReason) < 3) {
          throw new ApiError(400, 'O motivo da anulação deve conter pelo menos três letras.');
        }
        const mutableFields = new Set([
          'st', 'observations', 'voidReason', 'voidConfirmed', 'voidedBy', 'voidedAt',
          'refundedAt', 'refundMethod', 'refundReference', 'refundedBy'
        ]);
        if (paymentFields.some((field) => !mutableFields.has(field)
          && !same(payment[field], previous[field]))) {
          throw new ApiError(403, 'Os dados de um pagamento concluído não podem ser alterados ao anulá-lo.');
        }
        payment.voidedBy = user.n;
        payment.voidedAt = new Date().toISOString();
        payment.refundedAt = undefined;
        payment.refundMethod = undefined;
        payment.refundReference = undefined;
        payment.refundedBy = undefined;
      }
      if (previous.st === 'Pago' && payment.st === 'Estornado') {
        if (user.pf !== 'Administrador') {
          throw new ApiError(403, 'Só o administrador pode registar um estorno.');
        }
        if (letterCount(payment.refundReason) < 3) {
          throw new ApiError(400, 'O motivo do estorno deve conter pelo menos três letras.');
        }
        if (payment.refundConfirmed !== true) {
          throw new ApiError(400, 'Confirme que a devolução integral já foi efectuada.');
        }
        if (!validIsoDate(payment.refundedAt) || payment.refundedAt > clinicDateTime().date) {
          throw new ApiError(400, 'Indique uma data válida para a devolução.');
        }
        if (!['Dinheiro', 'Cartão', 'Transferência', 'Pagamento móvel'].includes(payment.refundMethod)) {
          throw new ApiError(400, 'Seleccione uma forma de devolução válida.');
        }
        if (typeof payment.refundReference !== 'string'
          || !payment.refundReference.trim() || payment.refundReference.trim().length > 120) {
          throw new ApiError(400, 'Indique a referência ou o comprovativo da devolução (máximo 120 caracteres).');
        }
        const mutableFields = new Set([
          'st', 'observations', 'refundReason', 'refundedAt', 'refundMethod',
          'refundReference', 'refundConfirmed', 'refundedBy', 'refundRequired'
        ]);
        if (paymentFields.some((field) => !mutableFields.has(field)
          && !same(payment[field], previous[field]))) {
          throw new ApiError(403, 'Os dados originais do pagamento concluído não podem ser alterados.');
        }
        payment.refundReference = payment.refundReference.trim();
        payment.refundedBy = user.n;
        payment.refundRequired = false;
      }
      if (previous.st === 'Pendente' && payment.st === 'Pago') {
        if (!['Administrador', 'Recepção'].includes(user.pf)) {
          throw new ApiError(403, 'Apenas a recepção ou o administrador podem registar pagamentos.');
        }
        if (payment.kind === 'Consulta' && (!appointment || appointment.st !== 'Concluída')) {
          throw new ApiError(409, 'A consulta tem de estar concluída antes de registar o pagamento.');
        }
        if (!paymentDetailIsValid(payment.m, payment.paymentDetails)) {
          throw new ApiError(400, 'Os dados exigidos para esta forma de pagamento são inválidos.');
        }
        payment.paidAt = new Date().toISOString().slice(0, 10);
        payment.receiptNumber = createReceiptNumber(submittedPayments);
        payment.registeredBy = user.n;
        payment.registeredAt = new Date().toISOString();
        payment.refundedAt = undefined;
        payment.voidedBy = undefined;
        payment.voidedAt = undefined;
      }
      if (payment.st === 'Pago' && !['Dinheiro', 'Cartão', 'Transferência', 'Pagamento móvel'].includes(payment.m)) {
        throw new ApiError(400, 'Seleccione uma forma de pagamento válida.');
      }
      if (previous.st === 'Pendente' && payment.st === 'Anulado') {
        const linkedAppointment = payment.appointmentId
          ? nextState.appointments.find((candidate) => candidate.id === payment.appointmentId)
          : null;
        const automaticCancellation = payment.kind === 'Consulta'
          && linkedAppointment
          && ['Cancelada', 'Faltou'].includes(linkedAppointment.st)
          && user.pf !== 'Financeiro';
        if (user.pf !== 'Administrador' && !automaticCancellation) {
          throw new ApiError(403, 'Só o administrador pode anular uma cobrança.');
        }
        if (!automaticCancellation && payment.voidConfirmed !== true) {
          throw new ApiError(400, 'Confirme que está a corrigir um registo inválido e não a devolver dinheiro.');
        }
        if (!automaticCancellation && letterCount(payment.voidReason || payment.refundReason) < 3) {
          throw new ApiError(400, 'O motivo da anulação deve conter pelo menos três letras.');
        }
        if (automaticCancellation) payment.refundReason = 'Consulta cancelada ou falta registada.';
        else payment.voidReason = payment.voidReason || payment.refundReason;
        payment.voidedBy = automaticCancellation ? 'Sistema' : user.n;
        payment.voidedAt = new Date().toISOString();
      }
      continue;
    }

    if (Object.keys(payment).some((field) => ![
      'id', 'kind', 'serviceId', 'd', 'pac', 'ds', 'v', 'st', 'm', 'med', 'appointmentId'
    ].includes(field))) {
      throw new ApiError(400, 'A nova cobrança contém campos inválidos.');
    }
    if (payment.kind === 'Consulta' && allowConsultationCreation && payment.st === 'Pendente') {
      const appointment = nextState.appointments.find((candidate) => candidate.id === payment.appointmentId);
      if (!appointment || appointment.pac !== payment.pac || appointment.med !== payment.med
        || appointment.d !== payment.d || Number(appointment.v) !== payment.v
        || appointment.st !== 'Concluída') {
        throw new ApiError(400, 'Só é possível criar uma cobrança para uma consulta concluída.');
      }
      continue;
    }
    if (!['Administrador', 'Recepção'].includes(user.pf)) {
      throw new ApiError(403, 'Apenas a recepção ou o administrador podem criar cobranças.');
    }
    if (payment.kind !== 'Tratamento' || payment.st !== 'Pendente') {
      throw new ApiError(403, 'Só é possível criar cobranças de tratamento ou consulta pendentes.');
    }
    const service = nextState.services.find((item) => item.id === payment.serviceId && item.active !== false);
    if (!service) throw new ApiError(400, 'Seleccione um serviço activo na lista de serviços.');
    if (!nextState.patients.some((patient) => patient.n === payment.pac)) {
      throw new ApiError(400, 'Seleccione um paciente válido para a cobrança.');
    }
    if (!Number.isSafeInteger(payment.v) || payment.v <= 0) throw new ApiError(400, 'O valor da cobrança deve ser um número inteiro positivo.');
    if (payment.v !== service.price) throw new ApiError(400, 'O valor da cobrança deve corresponder ao preço do serviço seleccionado.');
    if (!String(payment.ds || '').trim()) throw new ApiError(400, 'A descrição da cobrança é obrigatória.');
  }
}

function validateServices(services) {
  const ids = new Set();
  for (const service of services) {
    if (typeof service.id !== 'string' || !service.id.trim() || ids.has(service.id)) {
      throw new ApiError(400, 'Cada serviço deve ter um identificador único.');
    }
    ids.add(service.id);
    if (typeof service.name !== 'string' || !service.name.trim() || service.name.length > 120) {
      throw new ApiError(400, 'Indique um nome válido para cada serviço.');
    }
    if (!Number.isSafeInteger(service.price) || service.price <= 0) {
      throw new ApiError(400, 'O preço do serviço deve ser um número inteiro positivo.');
    }
    if (service.specialty !== undefined
      && (typeof service.specialty !== 'string' || !service.specialty.trim() || service.specialty.length > 100)) {
      throw new ApiError(400, 'Indique uma especialidade válida para o serviço.');
    }
    if (service.category !== undefined
      && (typeof service.category !== 'string' || !service.category.trim() || service.category.length > 120)) {
      throw new ApiError(400, 'Indique uma categoria válida para o serviço.');
    }
    if (service.active !== undefined && typeof service.active !== 'boolean') {
      throw new ApiError(400, 'O estado do serviço é inválido.');
    }
  }
}

function preventDeletingReferencedServices(currentState, nextState) {
  for (const service of currentState.services) {
    if (nextState.services.some((candidate) => candidate.id === service.id)) continue;
    if (currentState.payments.some((payment) => payment.serviceId === service.id)) {
      throw new ApiError(409, 'Um serviço usado no histórico de cobranças não pode ser eliminado; desactive-o.');
    }
    const specialty = service.specialty || 'Sem especialidade';
    const isConsultationPrice = service.name.trim().toLowerCase() === 'consulta';
    if (isConsultationPrice && currentState.appointments.some((appointment) => appointment.esp === specialty)) {
      throw new ApiError(409, 'Um preço de consulta associado a consultas existentes não pode ser eliminado; desactive-o.');
    }
  }
}

function auditTimestamp(ip) {
  const now = new Date();
  return {
    d: now.toISOString().slice(0, 10),
    h: now.toISOString().slice(11, 16),
    ip: ip || '—',
    timestamp: now.toISOString()
  };
}

function appendAuditEntries(current, submitted, next, user, ip) {
  const entries = current.audit.map(copy);
  const existing = new Set(current.audit.map((entry) => JSON.stringify(entry)));
  const time = auditTimestamp(ip);
  for (const entry of submitted.audit) {
    if (existing.has(JSON.stringify(entry))) continue;
    entries.unshift({
      ...entry,
      ...time,
      u: user.n
    });
    existing.add(JSON.stringify(entry));
  }

  const previousPayments = new Map(current.payments.map((payment) => [String(payment.id), payment]));
  for (const payment of next.payments) {
    const previous = previousPayments.get(String(payment.id));
    if (previous?.st === payment.st) continue;
    if (payment.st === 'Pago') {
      entries.unshift({
        ...time,
        u: payment.registeredBy || user.n,
        op: 'Pagamento registado',
        ds: `${payment.kind || 'Consulta'} de ${payment.pac} · ${payment.v} MT`,
        nv: 'Sucesso'
      });
    } else if (payment.st === 'Anulado') {
      entries.unshift({
        ...time,
        u: payment.voidedBy || user.n,
        op: 'Anulação de pagamento',
        ds: `${payment.pac} · ${payment.v} MT · ${payment.voidReason || payment.refundReason || 'Cobrança anulada'}`,
        nv: 'Aviso'
      });
    } else if (payment.st === 'Estornado') {
      entries.unshift({
        ...time,
        u: payment.refundedBy || user.n,
        op: 'Estorno de pagamento',
        ds: `${payment.pac} · ${payment.v} MT · ${payment.refundMethod} · ${payment.refundedAt} · ${payment.refundReference} · ${payment.refundReason}`,
        nv: 'Aviso'
      });
    }
  }
  next.audit = entries;
}

function applyAppointmentBillingRules(currentState, nextState) {
  const oldAppointments = new Map(currentState.appointments.map((appointment) => [appointment.id, appointment]));
  const appointmentIds = new Set();
  for (const appointment of nextState.appointments) {
    if (!appointment.id || appointmentIds.has(appointment.id)) {
      throw new ApiError(400, 'Os identificadores das consultas devem ser únicos.');
    }
    appointmentIds.add(appointment.id);
    const employee = byName(nextState.employees, appointment.med);
    if (!nextState.patients.some((patient) => patient.n === appointment.pac) || !employee || employee.f !== 'Médico') {
      throw new ApiError(400, 'Cada consulta deve estar associada a um paciente e a um médico válidos.');
    }
    const previous = oldAppointments.get(appointment.id);
    if (!nextState.payments.some((payment) => payment.appointmentId === appointment.id)) {
      const legacyCharges = nextState.payments.filter((payment) => !payment.appointmentId
        && payment.kind !== 'Tratamento'
        && payment.pac === appointment.pac
        && payment.med === appointment.med
        && payment.d === (previous?.d || appointment.d)
        && /consulta/i.test(payment.ds || ''));
      if (legacyCharges.length === 1) {
        legacyCharges[0].appointmentId = appointment.id;
        legacyCharges[0].kind = 'Consulta';
      }
    }
    if (!previous) {
      if (!appointment.id) throw new ApiError(400, 'A consulta precisa de um identificador.');
      if (appointment.st !== 'Agendada') {
        throw new ApiError(400, 'Uma nova consulta deve começar no estado Agendada.');
      }
      appointment.v = consultationPriceFor(employee, nextState.services);
    } else {
      appointment.v = previous.v;
      const allowedTransitions = {
        Agendada: ['Agendada', 'Em curso', 'Concluída', 'Cancelada', 'Faltou'],
        'Em curso': ['Em curso', 'Concluída', 'Cancelada'],
        'Concluída': ['Concluída'],
        Cancelada: ['Cancelada'],
        Faltou: ['Faltou']
      };
      if (!allowedTransitions[previous.st]?.includes(appointment.st)) {
        throw new ApiError(409, 'Transição de estado da consulta inválida.');
      }
      if (appointment.clinicalNote !== previous.clinicalNote
        && (!['Agendada', 'Em curso'].includes(previous.st) || appointment.st !== 'Concluída')) {
        throw new ApiError(403, 'O diagnóstico só pode ser registado ao concluir a consulta.');
      }
      if (previous.st !== 'Concluída' && appointment.st === 'Concluída'
        && letterCount(appointment.clinicalNote) < 3) {
        throw new ApiError(400, 'Registe o diagnóstico antes de concluir a consulta.');
      }
      if (previous.st !== 'Agendada' && (appointment.d !== previous.d || appointment.h !== previous.h)) {
        throw new ApiError(409, 'Só é possível reagendar uma consulta ainda agendada.');
      }
    }
    if (['Cancelada', 'Faltou'].includes(appointment.st)) {
      const charge = nextState.payments.find((payment) => payment.appointmentId === appointment.id);
      if (charge?.st === 'Pendente') {
        charge.st = 'Anulado';
        charge.refundReason = 'Consulta cancelada ou falta registada.';
      }
      if (charge?.st === 'Pago') charge.refundRequired = true;
    }

    const collision = nextState.appointments.some((candidate) => candidate !== appointment
      && candidate.med === appointment.med
      && candidate.d === appointment.d
      && candidate.h === appointment.h
      && !['Cancelada', 'Faltou'].includes(candidate.st));
    if (collision) throw new ApiError(409, 'O médico já tem uma consulta marcada para essa data e hora.');

    if (!['Agendada', 'Em curso', 'Concluída', 'Cancelada', 'Faltou'].includes(appointment.st)) {
      throw new ApiError(400, 'Estado de consulta inválido.');
    }
    if (!Number.isSafeInteger(Number(appointment.v)) || Number(appointment.v) <= 0) {
      throw new ApiError(400, 'O valor da consulta deve ser um número inteiro positivo.');
    }

    let charge = nextState.payments.find((payment) => payment.appointmentId === appointment.id && payment.st !== 'Anulado');
    if (!charge && appointment.st === 'Concluída') {
      charge = {
        id: Math.max(0, ...nextState.payments.map((payment) => Number(payment.id) || 0)) + 1,
        appointmentId: appointment.id,
        kind: 'Consulta',
        d: appointment.d,
        pac: appointment.pac,
        ds: `Consulta · ${appointment.esp}`,
        v: Number(appointment.v),
        st: 'Pendente',
        m: '—',
        med: appointment.med
      };
      nextState.payments.push(charge);
    }
    if (charge?.st === 'Pendente') {
      if (['Cancelada', 'Faltou'].includes(appointment.st)) {
        charge.st = 'Anulado';
        charge.refundReason = 'Consulta cancelada ou falta registada.';
      } else {
        charge.d = appointment.d;
        charge.pac = appointment.pac;
        charge.ds = `Consulta · ${appointment.esp}`;
        charge.v = Number(appointment.v);
        charge.med = appointment.med;
      }
    }
  }
}

export class StateAccessService {
  constructor(stateService) {
    this.stateService = stateService;
  }

  async getState(user) {
    if (!profiles.includes(user.pf)) throw new ApiError(403, 'O perfil da conta não tem acesso aos dados do sistema.');
    const result = await this.stateService.getState();
    return { ...result, state: roleView(result.state, user) };
  }

  async completeAppointment(user, appointmentId, clinicalNote, options = {}) {
    if (user.pf !== 'Médico') throw new ApiError(403, 'Apenas o médico responsável pode concluir a consulta.');
    const note = clinicalNote.trim();
    if (letterCount(note) < 3) throw new ApiError(400, 'Registe o diagnóstico antes de concluir a consulta.');

    const { state: current } = await this.stateService.getState();
    const doctorAppointments = current.appointments.filter((appointment) => appointment.med === user.n);
    const appointment = doctorAppointments.find((candidate) => String(candidate.id) === appointmentId);
    if (!appointment) throw new ApiError(404, 'Consulta não encontrada na agenda deste médico.');
    if (appointment.st === 'Concluída' && appointment.clinicalNote === note) return current;
    if (!['Agendada', 'Em curso'].includes(appointment.st)) {
      throw new ApiError(409, 'Esta consulta já não pode ser concluída.');
    }

    const next = copy(current);
    const appointmentToComplete = next.appointments.find((candidate) => String(candidate.id) === appointmentId);
    appointmentToComplete.st = 'Concluída';
    appointmentToComplete.clinicalNote = note;
    validateState(next);
    applyAppointmentBillingRules(current, next);
    enforceFinancialLedger(current.payments, next.payments, current, next, user, true);
    appendAuditEntries(current, next, next, user, options.ip);
    return this.stateService.saveState(next, options);
  }

  async saveState(user, submitted, options = {}) {
    validateState(submitted, { allowLegacyPatientIdentifiers: user.pf === 'Administrador' });
    validateServices(submitted.services);
    const { state: current } = await this.stateService.getState();
    if (user.pf === 'Administrador') {
      const next = copy(submitted);
      assignNewPatientIdentifiers(current.patients, next.patients);
      validateState(next);
      validateAppointmentSchedule(current.appointments, next.appointments, next.employees, next.services);
      for (const patient of current.patients) {
        if (next.patients.some((candidate) => candidate.p === patient.p)) continue;
        const hasActivity = current.appointments.some((appointment) => appointment.pac === patient.n)
          || current.payments.some((payment) => payment.pac === patient.n)
          || current.audit.some((entry) => `${entry.op || ''} ${entry.ds || ''}`.includes(patient.n));
        if (hasActivity) {
          throw new ApiError(409, `Não é possível eliminar ${patient.n}; desactive o paciente para preservar o histórico.`);
        }
      }
      for (const employee of current.employees) {
        if (next.employees.some((candidate) => candidate.n === employee.n)) continue;
        if (current.appointments.some((appointment) => appointment.med === employee.n)
          || current.audit.some((entry) => entry.u === employee.n)) {
          throw new ApiError(409, `Não é possível eliminar ${employee.n}; passe o funcionário a Inactivo para preservar o histórico.`);
        }
      }
      applyAppointmentBillingRules(current, next);
      preventDeletingReferencedServices(current, next);
      enforceFinancialLedger(current.payments, next.payments, current, next, user, true);
      appendAuditEntries(current, next, next, user, options.ip);
      return this.stateService.saveState(next, options);
    }

    enforceCollectionAccess(current, submitted, user);
    const next = copy(current);
    if (user.pf === 'Recepção') {
      next.patients = mergeReceptionPatients(current.patients, submitted.patients);
      assignNewPatientIdentifiers(current.patients, next.patients);
      next.appointments = mergeReceptionAppointments(current.appointments, submitted.appointments, current);
      next.payments = submitted.payments;
    } else if (user.pf === 'Médico') {
      next.appointments = mergeDoctorAppointments(
        current.appointments.filter((appointment) => appointment.med === user.n),
        submitted.appointments,
        user
      );
      const retained = current.appointments.filter((appointment) => appointment.med !== user.n);
      next.appointments = [...retained, ...next.appointments];
    } else if (user.pf === 'Financeiro') {
      throw new ApiError(403, 'O perfil Financeiro pode consultar os pagamentos, mas não os pode registar nem alterar.');
    } else {
      throw new ApiError(403, 'O perfil da conta não tem permissão para guardar dados.');
    }
    validateState(next);
    if (user.pf !== 'Financeiro') applyAppointmentBillingRules(current, next);
    preventDeletingReferencedServices(current, next);
    enforceFinancialLedger(current.payments, next.payments, current, next, user, user.pf !== 'Financeiro');
    appendAuditEntries(current, submitted, next, user, options.ip);
    return this.stateService.saveState(next, options);
  }
}
