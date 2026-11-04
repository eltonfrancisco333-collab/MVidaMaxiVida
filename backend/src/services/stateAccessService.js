import { ApiError } from '../utils/errors.js';
import { collections, validateState } from '../domain/state.js';

const profiles = ['Administrador', 'Recepção', 'Médico', 'Financeiro'];
const baseCollectionAccess = {
  Administrador: new Set(collections),
  Recepção: new Set(['patients', 'employees', 'appointments']),
  Médico: new Set(['patients', 'employees', 'appointments']),
  Financeiro: new Set(['patients', 'employees', 'appointments', 'payments', 'reports', 'services'])
};
const editableCollections = {
  Administrador: new Set(collections),
  Recepção: new Set(['patients', 'appointments']),
  Médico: new Set(['appointments']),
  Financeiro: new Set(['payments', 'reports'])
};

const copy = (value) => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const byName = (records, name) => records.find((record) => record.n === name);
const patientReferenceFields = ['n', 'p', 't', 'ta', 'e', 'bi', 'nc', 'ca', 'st'];

function projectPatient(patient, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(patient, field)).map((field) => [field, patient[field]]));
}

function roleView(state, user) {
  if (user.pf === 'Administrador') return copy(state);

  const view = Object.fromEntries(collections.map((name) => [name, []]));
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
    view.reports = copy(state.reports);
    view.services = copy(state.services);
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
  const previous = new Map(currentPatients.map((patient) => [patient.p, patient]));
  const merged = submittedPatients.map((patient) => {
    const old = previous.get(patient.p);
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
    return { ...old, ...patient };
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
      appointment.v = Number(doctor?.p) || 30000;
      appointment.mo = '';
      appointment.clinicalNote = '';
      appointment.rescheduleHistory = [];
    }
  }
  if (currentAppointments.some((appointment) => !submittedAppointments.some((next) => next.id === appointment.id))) {
    throw new ApiError(409, 'As consultas não podem ser eliminadas; cancele ou marque a falta para preservar o histórico.');
  }
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
    if (!['Agendada', 'Em curso', 'Concluída', 'Cancelada'].includes(appointment.st)) {
      throw new ApiError(400, 'Estado de consulta inválido.');
    }
    if (old.st !== 'Agendada' && old.st !== appointment.st) {
      throw new ApiError(409, 'Só é possível actualizar uma consulta ainda agendada.');
    }
  }
  if (currentAppointments.some((appointment) => appointment.med === user.n
    && !submittedAppointments.some((next) => next.id === appointment.id))) {
    throw new ApiError(403, 'O perfil médico não pode eliminar consultas.');
  }
  return submittedAppointments;
}

function enforceFinancialLedger(currentPayments, submittedPayments, currentState, nextState, allowConsultationCreation = false) {
  const oldById = new Map(currentPayments.map((payment) => [String(payment.id), payment]));
  const paymentIds = new Set();
  for (const payment of submittedPayments) {
    const id = String(payment.id);
    if (paymentIds.has(id)) throw new ApiError(400, 'Os identificadores das cobranças devem ser únicos.');
    paymentIds.add(id);
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
        'id', 'appointmentId', 'kind', 'd', 'pac', 'ds', 'v', 'st', 'm', 'med', 'serviceId',
        'paidAt', 'refundReason', 'refundedAt', 'refundRequired'
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
      if (previous.st === 'Anulado' && payment.st !== 'Anulado') {
        throw new ApiError(409, 'Uma cobrança anulada não pode ser reactivada.');
      }
      if (previous.st === 'Pago' && payment.st === 'Pendente') {
        throw new ApiError(409, 'Um pagamento concluído não pode voltar a pendente.');
      }
      if (!['Pendente', 'Pago', 'Anulado'].includes(payment.st)) throw new ApiError(400, 'Estado de pagamento inválido.');
      if (previous.st === 'Pendente' && payment.st === 'Pendente'
        && (payment.m !== previous.m || !same(payment.paidAt, previous.paidAt))) {
        throw new ApiError(403, 'Os dados de pagamento só podem ser preenchidos ao concluir a cobrança.');
      }
      if (previous.st === 'Pago' && payment.st === 'Anulado' && !String(payment.refundReason || '').trim()) {
        throw new ApiError(400, 'Indique o motivo do estorno integral.');
      }
      if (previous.st === 'Pago' && payment.st === 'Anulado') {
        payment.refundedAt = payment.refundedAt || new Date().toISOString().slice(0, 10);
      }
      if (previous.st === 'Pendente' && payment.st === 'Pago') {
        payment.paidAt = new Date().toISOString().slice(0, 10);
      }
      if (payment.st === 'Pago' && !['Dinheiro', 'Cartão', 'Transferência', 'Pagamento móvel'].includes(payment.m)) {
        throw new ApiError(400, 'Seleccione uma forma de pagamento válida.');
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
        || ['Cancelada', 'Faltou'].includes(appointment.st)) {
        throw new ApiError(400, 'A cobrança não corresponde à consulta agendada.');
      }
      continue;
    }
    if (payment.kind !== 'Tratamento' || payment.st !== 'Pendente') {
      throw new ApiError(403, 'Só é possível criar cobranças de tratamento ou consulta pendentes.');
    }
    const service = nextState.services.find((item) => item.id === payment.serviceId && item.active !== false);
    if (!service) throw new ApiError(400, 'Seleccione um serviço activo do catálogo.');
    if (!nextState.patients.some((patient) => patient.n === payment.pac)) {
      throw new ApiError(400, 'Seleccione um paciente válido para a cobrança.');
    }
    if (!Number.isSafeInteger(payment.v) || payment.v <= 0) throw new ApiError(400, 'O valor da cobrança deve ser um número inteiro positivo.');
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
    if (service.active !== undefined && typeof service.active !== 'boolean') {
      throw new ApiError(400, 'O estado do serviço é inválido.');
    }
  }
}

function preventDeletingReferencedServices(currentState, nextState) {
  for (const service of currentState.services) {
    if (!nextState.services.some((candidate) => candidate.id === service.id)
      && currentState.payments.some((payment) => payment.serviceId === service.id)) {
      throw new ApiError(409, 'Um serviço usado no histórico de cobranças não pode ser eliminado; desactive-o.');
    }
  }
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
    if (!previous) {
      if (!appointment.id) throw new ApiError(400, 'A consulta precisa de um identificador.');
      appointment.v = Number.isSafeInteger(appointment.v) && appointment.v > 0
        ? appointment.v
        : Number(employee.p) || 30000;
    } else if (previous.st === 'Cancelada' || previous.st === 'Faltou') {
      if (appointment.st !== previous.st) throw new ApiError(409, 'Uma consulta cancelada ou com falta não pode ser reactivada; crie uma nova marcação.');
    } else if (previous.st !== appointment.st && previous.st !== 'Agendada') {
      throw new ApiError(409, 'O estado final de uma consulta não pode ser alterado.');
    } else if (previous.st === 'Agendada' && ['Cancelada', 'Faltou'].includes(appointment.st)) {
      const charge = nextState.payments.find((payment) => payment.appointmentId === appointment.id);
      if (charge?.st === 'Pendente') charge.st = 'Anulado';
      if (charge?.st === 'Pago') {
        charge.refundRequired = true;
      }
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

    let charge = nextState.payments.find((payment) => payment.appointmentId === appointment.id);
    if (!charge && !['Cancelada', 'Faltou'].includes(appointment.st)) {
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
      charge.d = appointment.d;
      charge.pac = appointment.pac;
      charge.ds = `Consulta · ${appointment.esp}`;
      charge.v = Number(appointment.v);
      charge.med = appointment.med;
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

  async saveState(user, submitted, options) {
    validateState(submitted);
    validateServices(submitted.services);
    const { state: current } = await this.stateService.getState();
    if (user.pf === 'Administrador') {
      const next = copy(submitted);
      applyAppointmentBillingRules(current, next);
      preventDeletingReferencedServices(current, next);
      enforceFinancialLedger(current.payments, next.payments, current, next, true);
      return this.stateService.saveState(next, options);
    }

    enforceCollectionAccess(current, submitted, user);
    const next = copy(current);
    if (user.pf === 'Recepção') {
      next.patients = mergeReceptionPatients(current.patients, submitted.patients);
      next.appointments = mergeReceptionAppointments(current.appointments, submitted.appointments, current);
    } else if (user.pf === 'Médico') {
      next.appointments = mergeDoctorAppointments(
        current.appointments.filter((appointment) => appointment.med === user.n),
        submitted.appointments,
        user
      );
      const retained = current.appointments.filter((appointment) => appointment.med !== user.n);
      next.appointments = [...retained, ...next.appointments];
    } else if (user.pf === 'Financeiro') {
      next.payments = submitted.payments;
      next.reports = submitted.reports;
    } else {
      throw new ApiError(403, 'O perfil da conta não tem permissão para guardar dados.');
    }
    if (user.pf !== 'Financeiro') applyAppointmentBillingRules(current, next);
    preventDeletingReferencedServices(current, next);
    enforceFinancialLedger(current.payments, next.payments, current, next, user.pf !== 'Financeiro');
    return this.stateService.saveState(next, options);
  }
}
