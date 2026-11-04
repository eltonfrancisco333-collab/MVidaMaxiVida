import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApiServer } from './app.js';

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
  const request = (token, method, state) => fetch(`${baseUrl}/api/state`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    ...(state ? { body: JSON.stringify(state) } : {})
  });

  const initial = await (await request(administrator.token, 'GET')).json();
  const seeded = {
    ...initial,
    patients: [{
      n: 'Maria Teste', p: 'PTC-001', e: 'maria@example.org', t: '840000000',
      ta: '', bi: '', nc: '', ca: 'SMS', al: 'Alergia conhecida', tb: 'A+', st: 'Activo'
    }],
    employees: [
      { n: 'Dra. Ana', f: 'Médico', s: 'Clínica Geral', st: 'Activo', p: 45000 },
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
      id: 'appointment-1', d: '2026-11-06', h: '09:00', pac: 'Maria Teste',
      med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: 'Consulta de rotina', v: 45000
    }],
    services: [{ id: 'service-1', name: 'Fisioterapia', price: 25000, active: true }]
  };
  const seedResponse = await request(administrator.token, 'PUT', seeded);
  assert.equal(seedResponse.status, 200);

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
  const receptionStateResponse = await request(reception.token, 'GET');
  assert.equal(receptionStateResponse.status, 200);
  const receptionState = await receptionStateResponse.json();
  assert.equal(receptionState.patients[0].al, '');
  assert.equal(receptionState.patients[0].tb, '');
  assert.deepEqual(receptionState.payments, []);
  assert.deepEqual(receptionState.users, []);
  assert.equal(receptionState.appointments[0].mo, '');
  const changedClinicalInfo = structuredClone(receptionState);
  changedClinicalInfo.patients[0].al = 'Outra alergia';
  const forbiddenClinicalWrite = await request(reception.token, 'PUT', changedClinicalInfo);
  assert.equal(forbiddenClinicalWrite.status, 403);

  const doctor = await login('doctor@example.org');
  const doctorState = await (await request(doctor.token, 'GET')).json();
  assert.equal(doctorState.appointments.length, 1);
  assert.equal(doctorState.patients[0].al, 'Alergia conhecida');
  assert.deepEqual(doctorState.payments, []);
  const completed = structuredClone(doctorState);
  completed.appointments[0].st = 'Concluída';
  const completedResponse = await request(doctor.token, 'PUT', completed);
  assert.equal(completedResponse.status, 200);

  const finance = await login('finance@example.org');
  const financeState = await (await request(finance.token, 'GET')).json();
  assert.equal(financeState.patients[0].al, undefined);
  assert.equal(financeState.payments[0].st, 'Pendente');
  assert.equal(financeState.services[0].name, 'Fisioterapia');
  const paid = structuredClone(financeState);
  paid.payments[0].st = 'Pago';
  paid.payments[0].m = 'Dinheiro';
  const paidResponse = await request(finance.token, 'PUT', paid);
  assert.equal(paidResponse.status, 200);
  const paidState = await paidResponse.json();
  assert.equal(paidState.payments[0].st, 'Pago');
  assert.ok(paidState.payments[0].paidAt);

  const repriced = structuredClone(paidState);
  repriced.payments[0].v = 1;
  const repricingResponse = await request(finance.token, 'PUT', repriced);
  assert.equal(repricingResponse.status, 403);

  const withTreatment = structuredClone(paidState);
  withTreatment.payments.push({
    id: 2, kind: 'Tratamento', serviceId: 'service-1', d: '2026-11-06',
    pac: 'Maria Teste', ds: 'Fisioterapia - sessão especial', v: 28000, st: 'Pendente', m: '—'
  });
  const treatmentResponse = await request(finance.token, 'PUT', withTreatment);
  assert.equal(treatmentResponse.status, 200);
  const pendingTreatment = await treatmentResponse.json();
  assert.equal(pendingTreatment.payments[1].v, 28000);

  const paidTreatment = structuredClone(pendingTreatment);
  paidTreatment.payments[1].st = 'Pago';
  paidTreatment.payments[1].m = 'Transferência';
  const paidTreatmentResponse = await request(finance.token, 'PUT', paidTreatment);
  assert.equal(paidTreatmentResponse.status, 200);

  const treatmentRefund = await paidTreatmentResponse.json();
  treatmentRefund.payments[1].st = 'Anulado';
  treatmentRefund.payments[1].refundReason = 'Serviço não realizado';
  const refundResponse = await request(finance.token, 'PUT', treatmentRefund);
  assert.equal(refundResponse.status, 200);
  assert.equal((await refundResponse.json()).payments[1].st, 'Anulado');

  const receptionAppointments = await (await request(reception.token, 'GET')).json();
  receptionAppointments.appointments.push({
    id: 'appointment-2', d: '2026-11-07', h: '10:00', pac: 'Maria Teste',
    med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: '', clinicalNote: '', v: 45000
  });
  const newAppointmentResponse = await request(reception.token, 'PUT', receptionAppointments);
  assert.equal(newAppointmentResponse.status, 200);
  const newAppointmentState = await newAppointmentResponse.json();
  assert.ok(newAppointmentState.appointments.find((appointment) => appointment.id === 'appointment-2'));

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
  assert.equal(noShowCharge.st, 'Anulado');

  const thirdAppointment = await (await request(reception.token, 'GET')).json();
  thirdAppointment.appointments.push({
    id: 'appointment-3', d: '2026-11-08', h: '10:00', pac: 'Maria Teste',
    med: 'Dra. Ana', esp: 'Clínica Geral', st: 'Agendada', mo: '', clinicalNote: '', v: 45000
  });
  const thirdAppointmentResponse = await request(reception.token, 'PUT', thirdAppointment);
  assert.equal(thirdAppointmentResponse.status, 200);
  const financeWithThirdCharge = await (await request(finance.token, 'GET')).json();
  const thirdCharge = financeWithThirdCharge.payments.find((payment) => payment.appointmentId === 'appointment-3');
  assert.equal(thirdCharge.st, 'Pendente');
  thirdCharge.st = 'Pago';
  thirdCharge.m = 'Dinheiro';
  assert.equal((await request(finance.token, 'PUT', financeWithThirdCharge)).status, 200);

  const cancelPaidAppointment = await (await request(reception.token, 'GET')).json();
  cancelPaidAppointment.appointments.find((appointment) => appointment.id === 'appointment-3').st = 'Cancelada';
  assert.equal((await request(reception.token, 'PUT', cancelPaidAppointment)).status, 200);
  const refundRequiredState = await (await request(finance.token, 'GET')).json();
  assert.equal(refundRequiredState.payments.find((payment) => payment.appointmentId === 'appointment-3').refundRequired, true);
});
