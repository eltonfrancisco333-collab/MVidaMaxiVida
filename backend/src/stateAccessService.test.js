import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApiServer } from './app.js';
import { initialState } from './domain/state.js';
import { StateAccessService } from './services/stateAccessService.js';

const maputoDate = (offset) => {
  const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

test('a recepção recebe um número de processo gerado pelo servidor', async () => {
  const current = { ...structuredClone(initialState), _revision: 1 };
  let saved;
  const access = new StateAccessService({
    getState: async () => ({ state: structuredClone(current) }),
    saveState: async (state) => {
      saved = structuredClone(state);
      return saved;
    }
  });
  const submitted = structuredClone(current);
  submitted.patients.push({
    n: 'Paciente Novo', e: 'novo@example.org', t: '840000099', al: '', tb: ''
  });

  await access.saveState({ n: 'Recepção', pf: 'Recepção' }, submitted);
  assert.equal(saved.patients[0].p, 'PTC-001');
});

test('a API isola dados por perfil e aplica estados de cobrança no servidor', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mvida-role-access-'));
  const server = createApiServer({
    dataFile: path.join(directory, 'state.json'),
    credentialsFile: path.join(directory, 'credentials.json')
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const setup = await fetch(`${baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin', email: 'admin@example.org', password: 'palavra-passe-admin-123' })
  });
  const administrator = await setup.json();
  const auth = (token) => ({ Authorization: 'Bearer ' + token });
  const request = (token, method, state, extraHeaders = {}) => fetch(`${baseUrl}/api/state`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth(token), ...extraHeaders },
    ...(state ? { body: JSON.stringify(state) } : {})
  });

  const initial = await (await request(administrator.token, 'GET')).json();
  const firstAppointmentDate = maputoDate(2), secondAppointmentDate = maputoDate(3), thirdAppointmentDate = maputoDate(4);
  const seeded = {
    ...initial,
    patients: [{
      n: 'Maria Teste', p: 'PTC-001', e: 'maria@example.org', t: '840000000',
      ta: '', bi: '', nc: '', ca: 'SMS', al: 'Alergia conhecida', tb: 'A+', st: 'Activo'
    }],
    employees: [
      {
        n: 'Dra. Ana', f: 'Médico', s: 'Clínica Geral', st: 'Activo', p: 45000,
        h: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((day) => [day, '08:00', '17:00'])
      },
      { n: 'Recepcionista', f: 'Recepção', s: '', st: 'Activo' },
      { n: 'Financeiro', f: 'Financeiro', s: '', st: 'Activo' }
    ],
    users: [
      ...initial.users,
      { n: 'Dra. Ana', e: 'doctor@example.org', pf: 'Médico', st: 'Activa' },
      { n: 'Recepcionista', e: 'reception@example.org', pf: 'Recepção', st: 'Activa' },
      { n: 'Financeiro', e: 'finance@example.org', pf: 'Financeiro', st: 'Activa' }
    ],
    appointments: [{
      id: 'appointment-1', d: firstAppointmentDate, h: '09:00', pac: 'Maria Teste',
      med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: 'Consulta de rotina', v: 52000
    }],
    services: [
      { id: 'service-1', name: 'Fisioterapia', price: 25000, active: true },
      { id: 'service-unused', name: 'Massagem', specialty: 'Dermatologia', price: 18000, active: true },
      { id: 'consultation-clinical', name: 'Consulta', specialty: 'Clínica Geral', price: 52000, active: true }
    ]
  };
  const seedResponse = await request(administrator.token, 'PUT', seeded);
  assert.equal(seedResponse.status, 200);
  let latestState = await seedResponse.json();
  const unusedServiceRemoval = structuredClone(latestState);
  unusedServiceRemoval.services = unusedServiceRemoval.services.filter((service) => service.id !== 'service-unused');
  const unusedServiceRemovalResponse = await request(administrator.token, 'PUT', unusedServiceRemoval);
  assert.equal(unusedServiceRemovalResponse.status, 200);
  latestState = await unusedServiceRemovalResponse.json();
  const consultationPriceRemoval = structuredClone(latestState);
  consultationPriceRemoval.services = consultationPriceRemoval.services.filter((service) => service.id !== 'consultation-clinical');
  const protectedPriceRemoval = await request(administrator.token, 'PUT', consultationPriceRemoval);
  assert.equal(protectedPriceRemoval.status, 409);

  const disabledConsultation = await (await request(administrator.token, 'GET')).json();
  disabledConsultation.services.find((service) => service.id === 'consultation-clinical').active = false;
  const disableConsultationResponse = await request(administrator.token, 'PUT', disabledConsultation);
  assert.equal(disableConsultationResponse.status, 200);
  const disabledConsultationState = await disableConsultationResponse.json();
  assert.equal(disabledConsultationState.services.find((service) => service.id === 'consultation-clinical').active, false);
  assert.equal(disabledConsultationState.appointments.find((appointment) => appointment.id === 'appointment-1').v, 52000);
  const unavailableConsultation = structuredClone(disabledConsultationState);
  unavailableConsultation.appointments.push({
    id: 'appointment-disabled-specialty', d: secondAppointmentDate, h: '10:00', pac: 'Maria Teste',
    med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: '', clinicalNote: '', v: 52000
  });
  const unavailableConsultationResponse = await request(administrator.token, 'PUT', unavailableConsultation);
  assert.equal(unavailableConsultationResponse.status, 400);
  assert.match((await unavailableConsultationResponse.json()).error, /consulta desta especialidade está desactivada/i);
  const disabledStateAfterRejectedBooking = await (await request(administrator.token, 'GET')).json();
  assert.equal(disabledStateAfterRejectedBooking.appointments.some((appointment) => appointment.id === 'appointment-disabled-specialty'), false);
  disabledStateAfterRejectedBooking.services.find((service) => service.id === 'consultation-clinical').active = true;
  assert.equal((await request(administrator.token, 'PUT', disabledStateAfterRejectedBooking)).status, 200);

  const temporaryPasswords = {};
  for (const email of ['doctor@example.org', 'reception@example.org', 'finance@example.org']) {
    const reset = await fetch(`${baseUrl}/api/users/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(administrator.token) },
      body: JSON.stringify({ email })
    });
    assert.equal(reset.status, 200);
    temporaryPasswords[email] = (await reset.json()).temporaryPassword;
  }
  const login = async (email) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: temporaryPasswords[email] })
    });
    assert.equal(response.status, 200);
    const session = await response.json();
    const lockedState = await request(session.token, 'GET');
    assert.equal(lockedState.status, 403);
    const change = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(session.token) },
      body: JSON.stringify({
        currentPassword: temporaryPasswords[email],
        newPassword: `password-${email.split('@')[0]}-safe-123`
      })
    });
    assert.equal(change.status, 200);
    return change.json();
  };

  const reception = await login('reception@example.org');
  assert.ok(reception.user);
  assert.equal(reception.user.e, 'reception@example.org');
  assert.equal(reception.user.pf, 'Recepção');
  const receptionStateResponse = await request(reception.token, 'GET');
  assert.equal(receptionStateResponse.status, 200);
  const receptionState = await receptionStateResponse.json();
  assert.equal(receptionState.patients[0].al, '');
  assert.equal(receptionState.patients[0].tb, '');
  assert.deepEqual(receptionState.payments, []);
  assert.deepEqual(receptionState.users, []);
  assert.equal(receptionState.appointments[0].mo, '');
  const pastAppointment = structuredClone(receptionState);
  pastAppointment.appointments.push({
    id: 'appointment-past', d: '2020-01-01', h: '10:00', pac: 'Maria Teste',
    med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: '', clinicalNote: '', v: 45000
  });
  assert.equal((await request(reception.token, 'PUT', pastAppointment)).status, 400);
  const outsideSchedule = structuredClone(receptionState);
  outsideSchedule.appointments.push({
    id: 'appointment-outside-hours', d: secondAppointmentDate, h: '17:00', pac: 'Maria Teste',
    med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: '', clinicalNote: '', v: 45000
  });
  assert.equal((await request(reception.token, 'PUT', outsideSchedule)).status, 400);
  const conflictingAppointment = structuredClone(receptionState);
  conflictingAppointment.appointments.push({
    id: 'appointment-conflict', d: firstAppointmentDate, h: '09:00', pac: 'Maria Teste',
    med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: '', clinicalNote: '', v: 45000
  });
  assert.equal((await request(reception.token, 'PUT', conflictingAppointment)).status, 409);
  const changedClinicalInfo = structuredClone(receptionState);
  changedClinicalInfo.patients[0].al = 'Outra alergia';
  const forbiddenClinicalWrite = await request(reception.token, 'PUT', changedClinicalInfo);
  assert.equal(forbiddenClinicalWrite.status, 403);

  const doctor = await login('doctor@example.org');
  const doctorState = await (await request(doctor.token, 'GET')).json();
  assert.equal(doctorState.appointments.length, 1);
  assert.equal(doctorState.patients[0].al, 'Alergia conhecida');
  assert.deepEqual(doctorState.payments, []);
  const directCompletion = structuredClone(doctorState);
  directCompletion.appointments[0].st = 'Concluída';
  directCompletion.appointments[0].clinicalNote = 'Diagnóstico teste';
  assert.equal((await request(doctor.token, 'PUT', directCompletion)).status, 409);

  const started = structuredClone(doctorState);
  started.appointments[0].st = 'Em curso';
  const startedResponse = await request(doctor.token, 'PUT', started);
  assert.equal(startedResponse.status, 200);
  assert.deepEqual((await (await request(administrator.token, 'GET')).json()).payments, []);

  const noDiagnosis = await (await request(doctor.token, 'GET')).json();
  noDiagnosis.appointments[0].st = 'Concluída';
  assert.equal((await request(doctor.token, 'PUT', noDiagnosis)).status, 400);

  const completed = await (await request(doctor.token, 'GET')).json();
  completed.appointments[0].st = 'Concluída';
  completed.appointments[0].clinicalNote = 'Diagnóstico teste';
  const completedResponse = await request(doctor.token, 'PUT', completed);
  assert.equal(completedResponse.status, 200);

  const finance = await login('finance@example.org');
  const financeState = await (await request(finance.token, 'GET')).json();
  assert.equal(financeState.patients[0].al, undefined);
  assert.equal(financeState.payments[0].st, 'Pendente');
  assert.deepEqual(financeState.services, []);
  assert.deepEqual(financeState.reports, []);
  const financeTreatment = structuredClone(financeState);
  financeTreatment.payments.push({
    id: 20, kind: 'Tratamento', serviceId: 'service-1', d: '2026-11-06',
    pac: 'Maria Teste', ds: 'Fisioterapia', v: 25000, st: 'Pendente', m: '—'
  });
  assert.equal((await request(finance.token, 'PUT', financeTreatment)).status, 403);
  const financePaid = structuredClone(financeState);
  financePaid.payments[0].st = 'Pago';
  financePaid.payments[0].m = 'Dinheiro';
  assert.equal((await request(finance.token, 'PUT', financePaid)).status, 403);

  const receptionPayments = await (await request(reception.token, 'GET')).json();
  const missingMobileNumber = structuredClone(receptionPayments);
  missingMobileNumber.payments[0].st = 'Pago';
  missingMobileNumber.payments[0].m = 'Pagamento móvel';
  missingMobileNumber.payments[0].paymentDetails = '831234567';
  assert.equal((await request(reception.token, 'PUT', missingMobileNumber)).status, 400);
  const paid = structuredClone(receptionPayments);
  paid.payments[0].st = 'Pago';
  paid.payments[0].m = 'Pagamento móvel';
  paid.payments[0].paymentDetails = '841234567';
  const paidResponse = await request(reception.token, 'PUT', paid, { 'x-forwarded-for': '203.0.113.12' });
  assert.equal(paidResponse.status, 200);
  const paidState = await paidResponse.json();
  assert.equal(paidState.payments[0].st, 'Pago');
  assert.ok(paidState.payments[0].paidAt);
  assert.match(paidState.payments[0].receiptNumber, /^DIN[A-F0-9]{14}$/);
  assert.equal(paidState.payments[0].registeredBy, 'Recepcionista');
  const paymentAuditState = await (await request(administrator.token, 'GET')).json();
  const paymentAudit = paymentAuditState.audit.find((entry) => entry.op === 'Pagamento registado');
  assert.equal(paymentAudit.u, 'Recepcionista');
  assert.equal(paymentAudit.ip, '203.0.113.12');

  const receptionVoid = structuredClone(paidState);
  receptionVoid.payments[0].st = 'Anulado';
  receptionVoid.payments[0].refundReason = 'Erro';
  assert.equal((await request(reception.token, 'PUT', receptionVoid)).status, 403);
  const withReceptionNote = structuredClone(paidState);
  withReceptionNote.payments[0].observations = 'Pagamento confirmado no balcão.';
  assert.equal((await request(reception.token, 'PUT', withReceptionNote)).status, 200);
  const consultationVoid = await (await request(administrator.token, 'GET')).json();
  consultationVoid.payments.find((payment) => payment.appointmentId === 'appointment-1').st = 'Anulado';
  consultationVoid.payments.find((payment) => payment.appointmentId === 'appointment-1').refundReason = 'Erro de pagamento registado';
  const consultationVoidResponse = await request(administrator.token, 'PUT', consultationVoid);
  assert.equal(consultationVoidResponse.status, 200);
  const voidedConsultationState = await consultationVoidResponse.json();
  const consultationCharges = voidedConsultationState.payments
    .filter((payment) => payment.appointmentId === 'appointment-1');
  assert.equal(consultationCharges.filter((payment) => payment.st === 'Anulado').length, 1);
  assert.equal(consultationCharges.filter((payment) => payment.st === 'Pendente').length, 1);
  assert.ok(consultationCharges.find((payment) => payment.st === 'Anulado').voidedAt);
  assert.ok(consultationCharges.find((payment) => payment.st === 'Anulado').voidedBy);

  const repriced = structuredClone(await (await request(administrator.token, 'GET')).json());
  repriced.payments[0].v = 1;
  const repricingResponse = await request(administrator.token, 'PUT', repriced);
  assert.equal(repricingResponse.status, 403);

  const withTreatment = structuredClone(await (await request(reception.token, 'GET')).json());
  const treatmentChargeId = Math.max(0, ...withTreatment.payments.map((payment) => Number(payment.id))) + 1;
  withTreatment.payments.push({
    id: treatmentChargeId, kind: 'Tratamento', serviceId: 'service-1', d: '2026-11-06',
    pac: 'Maria Teste', ds: 'Fisioterapia - sessão especial', v: 28000, st: 'Pendente', m: '—'
  });
  const treatmentResponse = await request(reception.token, 'PUT', withTreatment);
  assert.equal(treatmentResponse.status, 200);
  const pendingTreatment = await treatmentResponse.json();
  assert.equal(pendingTreatment.payments.find((payment) => payment.id === treatmentChargeId).v, 28000);

  const incompleteTransfer = structuredClone(pendingTreatment);
  const incompleteTransferCharge = incompleteTransfer.payments.find((payment) => payment.id === treatmentChargeId);
  incompleteTransferCharge.st = 'Pago';
  incompleteTransferCharge.m = 'Transferência';
  incompleteTransferCharge.paymentDetails = '';
  assert.equal((await request(reception.token, 'PUT', incompleteTransfer)).status, 400);
  const paidTreatment = structuredClone(pendingTreatment);
  const paidTreatmentCharge = paidTreatment.payments.find((payment) => payment.id === treatmentChargeId);
  paidTreatmentCharge.st = 'Pago';
  paidTreatmentCharge.m = 'Transferência';
  paidTreatmentCharge.paymentDetails = 'TRF-12345';
  const paidTreatmentResponse = await request(reception.token, 'PUT', paidTreatment);
  assert.equal(paidTreatmentResponse.status, 200);

  const shortReason = await (await request(administrator.token, 'GET')).json();
  shortReason.payments.find((payment) => payment.id === treatmentChargeId).st = 'Anulado';
  shortReason.payments.find((payment) => payment.id === treatmentChargeId).refundReason = 'ok';
  assert.equal((await request(administrator.token, 'PUT', shortReason)).status, 400);
  const treatmentRefund = await paidTreatmentResponse.json();
  treatmentRefund.payments.find((payment) => payment.id === treatmentChargeId).st = 'Anulado';
  treatmentRefund.payments.find((payment) => payment.id === treatmentChargeId).refundReason = 'Serviço não realizado';
  assert.equal((await request(reception.token, 'PUT', treatmentRefund)).status, 403);
  const adminTreatmentRefund = await (await request(administrator.token, 'GET')).json();
  adminTreatmentRefund.payments.find((payment) => payment.id === treatmentChargeId).st = 'Anulado';
  adminTreatmentRefund.payments.find((payment) => payment.id === treatmentChargeId).refundReason = 'Serviço não realizado';
  const refundResponse = await request(administrator.token, 'PUT', adminTreatmentRefund);
  assert.equal(refundResponse.status, 200);
  assert.equal((await refundResponse.json()).payments.find((payment) => payment.id === treatmentChargeId).st, 'Anulado');

  const receptionAppointments = await (await request(reception.token, 'GET')).json();
  receptionAppointments.appointments.push({
    id: 'appointment-2', d: secondAppointmentDate, h: '10:00', pac: 'Maria Teste',
    med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: 'Consulta de acompanhamento', clinicalNote: '', v: 45000
  });
  const newAppointmentResponse = await request(reception.token, 'PUT', receptionAppointments);
  assert.equal(newAppointmentResponse.status, 200);
  const newAppointmentState = await newAppointmentResponse.json();
  assert.ok(newAppointmentState.appointments.find((appointment) => appointment.id === 'appointment-2'));
  assert.equal(newAppointmentState.appointments.find((appointment) => appointment.id === 'appointment-2').v, 52000);
  const appointmentWithReason = await (await request(administrator.token, 'GET')).json();
  assert.equal(appointmentWithReason.appointments.find((appointment) => appointment.id === 'appointment-2').mo, 'Consulta de acompanhamento');
  assert.equal(newAppointmentState.payments.some((payment) => payment.appointmentId === 'appointment-2'), false);

  const rescheduled = structuredClone(newAppointmentState);
  rescheduled.appointments.find((appointment) => appointment.id === 'appointment-2').h = '11:00';
  const rescheduleResponse = await request(reception.token, 'PUT', rescheduled);
  assert.equal(rescheduleResponse.status, 200);
  const rescheduledState = await rescheduleResponse.json();
  assert.equal(rescheduledState.appointments.find((appointment) => appointment.id === 'appointment-2').rescheduleHistory.length, 1);

  const noShow = structuredClone(rescheduledState);
  noShow.appointments.find((appointment) => appointment.id === 'appointment-2').st = 'Faltou';
  const noShowResponse = await request(reception.token, 'PUT', noShow);
  assert.equal(noShowResponse.status, 200);
  const administratorState = await (await request(administrator.token, 'GET')).json();
  const noShowCharge = administratorState.payments.find((payment) => payment.appointmentId === 'appointment-2');
  assert.equal(noShowCharge, undefined);

  const thirdAppointment = await (await request(reception.token, 'GET')).json();
  thirdAppointment.appointments.push({
    id: 'appointment-3', d: thirdAppointmentDate, h: '10:00', pac: 'Maria Teste',
    med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: '', clinicalNote: '', v: 45000
  });
  const thirdAppointmentResponse = await request(reception.token, 'PUT', thirdAppointment);
  assert.equal(thirdAppointmentResponse.status, 200);
  const financeBeforeCompletion = await (await request(finance.token, 'GET')).json();
  assert.equal(financeBeforeCompletion.payments.some((payment) => payment.appointmentId === 'appointment-3'), false);
  const doctorAppointments = await (await request(doctor.token, 'GET')).json();
  doctorAppointments.appointments.find((appointment) => appointment.id === 'appointment-3').st = 'Em curso';
  const thirdStartResponse = await request(doctor.token, 'PUT', doctorAppointments);
  assert.equal(thirdStartResponse.status, 200, await thirdStartResponse.text());
  const doctorCompletion = await (await request(doctor.token, 'GET')).json();
  const appointmentToComplete = doctorCompletion.appointments.find((appointment) => appointment.id === 'appointment-3');
  appointmentToComplete.st = 'Concluída';
  appointmentToComplete.clinicalNote = 'Diagnóstico da terceira consulta';
  const thirdCompletionResponse = await request(doctor.token, 'PUT', doctorCompletion);
  assert.equal(thirdCompletionResponse.status, 200, await thirdCompletionResponse.text());
  const financeAfterCompletion = await (await request(finance.token, 'GET')).json();
  assert.equal(financeAfterCompletion.payments.find((payment) => payment.appointmentId === 'appointment-3').st, 'Pendente');

  const cancelCompletedAppointment = await (await request(reception.token, 'GET')).json();
  cancelCompletedAppointment.appointments.find((appointment) => appointment.id === 'appointment-3').st = 'Cancelada';
  assert.equal((await request(reception.token, 'PUT', cancelCompletedAppointment)).status, 409);
});
