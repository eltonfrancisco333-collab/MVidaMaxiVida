import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApiServer } from './app.js';

test('a API persiste o modelo de dados do dashboard e protege a migração inicial', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mvida-api-'));
  const dataFile = path.join(directory, 'state.json');
  const server = createApiServer({ dataFile, credentialsFile: path.join(directory, 'credentials.json'), allowUnauthenticatedState: true });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const initialResponse = await fetch(`${baseUrl}/api/state`);
  assert.equal(initialResponse.status, 200);
  assert.equal(initialResponse.headers.get('X-MVida-Data-Source'), 'seed');
  const emptyState = await initialResponse.json();
  assert.deepEqual(Object.keys(emptyState), ['patients', 'employees', 'users', 'appointments', 'payments', 'audit', 'reports', 'services']);

  const demoState = {
    patients: [{ n: 'Maria da Silva Santos', p: 'PTC-001', t: '932 123 456', e: 'maria@email.ao', st: 'Activo' }],
    employees: [{ n: 'Dr. Carlos Silva', f: 'Médico', s: 'Clínica Geral', st: 'Activo' }],
    users: [{ n: 'admin', e: 'admin@mvida.ao', pf: 'Administrador', st: 'Activa' }],
    appointments: [{ d: '2025-04-28', h: '09:00', pac: 'Maria da Silva Santos', med: 'Dr. Carlos Silva', esp: 'Clínica Geral', st: 'Agendada', mo: '' }],
    payments: [{ id: 1, d: '2025-04-28', pac: 'Maria da Silva Santos', ds: 'Consulta', v: 30000, st: 'Pendente', m: '—', med: 'Dr. Carlos Silva' }],
    audit: [{ d: '2025-04-28', h: '14:32', u: 'admin', op: 'Início de sessão', ds: 'Utilizador entrou no sistema', nv: 'Informação', ip: '192.168.1.10' }],
    reports: [{ ty: 'geral', t: 'Relatório Geral', d: 'Resumo geral', a: '2025-04-01', b: '2025-04-28', g: '2025-04-28 14:32', c: { k: [], h: [], r: [] } }],
    services: []
  };
  const migrationResponse = await fetch(`${baseUrl}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(demoState)
  });
  assert.equal(migrationResponse.status, 200);

  const repeatedMigrationResponse = await fetch(`${baseUrl}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(demoState)
  });
  assert.equal(repeatedMigrationResponse.status, 409);

  const updatedState = { ...demoState, appointments: [{ ...demoState.appointments[0], st: 'Concluída' }] };
  const saveResponse = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedState)
  });
  assert.equal(saveResponse.status, 200);

  const withoutLinkedPatient = { ...updatedState, patients: [] };
  const protectedPatientResponse = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withoutLinkedPatient)
  });
  assert.equal(protectedPatientResponse.status, 409);

  const withoutLinkedDoctor = { ...updatedState, employees: [] };
  const protectedDoctorResponse = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withoutLinkedDoctor)
  });
  assert.equal(protectedDoctorResponse.status, 409);

  const invalidResponse = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updatedState, employees: null })
  });
  assert.equal(invalidResponse.status, 400);

  const persistedResponse = await fetch(`${baseUrl}/api/state`);
  assert.equal(persistedResponse.headers.get('X-MVida-Data-Source'), 'file');
  const persistedState = await persistedResponse.json();
  assert.equal(persistedState.appointments[0].st, 'Concluída');
  assert.equal(persistedState.payments[0].m, '—');
  assert.equal(persistedState.patients.length, 1);
  assert.equal(persistedState.employees.length, 1);
});

test('a API migra IDs ausentes ou inválidos sem criar colisões', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mvida-legacy-ids-'));
  const dataFile = path.join(directory, 'state.json');
  await writeFile(dataFile, JSON.stringify({
    patients: [],
    employees: [],
    users: [],
    appointments: [{ id: 'consulta-legada-1' }, {}, { id: '' }],
    payments: [{ id: 4 }, { id: 'inválido' }, { id: 4 }],
    audit: [],
    reports: []
  }));
  const server = createApiServer({
    dataFile,
    credentialsFile: path.join(directory, 'credentials.json'),
    allowUnauthenticatedState: true
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const stateResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.deepEqual(state.appointments.map((appointment) => appointment.id), [
    'consulta-legada-1', 'consulta-legada-2', 'consulta-legada-3'
  ]);
  assert.deepEqual(state.payments.map((payment) => payment.id), [4, 5, 6]);
});

test('a API aceita a correcção de nomes corrompidos sem desproteger pacientes associados', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mvida-api-encoding-'));
  const dataFile = path.join(directory, 'state.json');
  const server = createApiServer({ dataFile, credentialsFile: path.join(directory, 'credentials.json'), allowUnauthenticatedState: true });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const corruptedName = 'Jo\uFFFDo Manuel Costa';
  const state = {
    patients: [{ n: corruptedName }],
    employees: [{ n: 'Dr. Carlos Silva' }],
    users: [],
    appointments: [{ pac: corruptedName, med: 'Dr. Carlos Silva' }],
    payments: [],
    services: [],
    audit: [],
    reports: []
  };
  const migration = await fetch(`${baseUrl}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });
  assert.equal(migration.status, 200);

  const correctedState = {
    ...state,
    patients: [{ n: 'João Manuel Costa' }],
    appointments: [{ pac: 'João Manuel Costa', med: 'Dr. Carlos Silva' }]
  };
  const correction = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(correctedState)
  });
  assert.equal(correction.status, 200);

  const protectedDeletion = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...correctedState, patients: [] })
  });
  assert.equal(protectedDeletion.status, 409);
});

test('o servidor de produção entrega o frontend compilado e suporta rotas do dashboard', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mvida-deploy-'));
  const dataFile = path.join(directory, 'state.json');
  const staticDirectory = path.join(directory, 'dist');
  await mkdir(staticDirectory, { recursive: true });
  await writeFile(path.join(staticDirectory, 'index.html'), '<main>MVida pronto para deploy</main>');
  await writeFile(path.join(staticDirectory, 'mvida-api-bridge.js'), 'console.log("bridge")');
  await writeFile(path.join(staticDirectory, 'index-C5o2jPOs.js'), 'console.log("hashed")');
  const server = createApiServer({
    dataFile,
    credentialsFile: path.join(directory, 'credentials.json'),
    staticDirectory
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
  const page = await fetch(`${baseUrl}/consultas`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /MVida pronto para deploy/);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');

  const bridge = await fetch(`${baseUrl}/mvida-api-bridge.js`);
  assert.equal(bridge.headers.get('cache-control'), 'no-cache');
  const hashedAsset = await fetch(`${baseUrl}/index-C5o2jPOs.js`);
  assert.equal(hashedAsset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const missingApiRoute = await fetch(`${baseUrl}/api/nao-existe`);
  assert.equal(missingApiRoute.status, 404);
});

test('a primeira utilização começa sem registos e permite criar o administrador inicial', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mvida-first-run-'));
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
  const anonymousState = await fetch(`${baseUrl}/api/state`);
  assert.equal(anonymousState.status, 401);
  const setupStatus = await fetch(`${baseUrl}/api/setup/status`);
  assert.deepEqual(await setupStatus.json(), { configured: false });

  const invalidSetup = await fetch(`${baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin', email: 'admin@example.org', password: 'short' })
  });
  assert.equal(invalidSetup.status, 400);

  const setup = await fetch(`${baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Administradora', email: 'ADMIN@example.org', password: 'uma-senha-forte-123' })
  });
  assert.equal(setup.status, 201);
  const created = await setup.json();
  assert.equal(created.user.e, 'admin@example.org');
  assert.equal(created.user.pf, 'Administrador');
  assert.equal(created.user.protectedAdministrator, true);
  assert.equal(typeof created.token, 'string');
  assert.equal(Object.hasOwn(created.user, 'password'), false);
  const authHeaders = (token = created.token) => ({ Authorization: 'Bearer ' + token });

  const savedResponse = await fetch(`${baseUrl}/api/state`, { headers: authHeaders() });
  const savedState = await savedResponse.json();
  assert.deepEqual(savedState.patients, []);
  assert.deepEqual(savedState.employees, []);
  assert.deepEqual(savedState.appointments, []);
  assert.equal(savedState.users.length, 1);
  assert.equal(Object.hasOwn(savedState.users[0], 'hash'), false);

  const tamperedAdminState = {
    ...savedState,
    users: savedState.users.map((user) => ({ ...user, pf: 'Médico' }))
  };
  const tamperAdmin = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(tamperedAdminState)
  });
  assert.equal(tamperAdmin.status, 409);

  const deactivateAdministratorState = {
    ...savedState,
    users: savedState.users.map((user) => ({ ...user, st: 'Desactivada' }))
  };
  const deactivateAdministrator = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(deactivateAdministratorState)
  });
  assert.equal(deactivateAdministrator.status, 409);

  const deleteAdministrator = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...savedState, users: [] })
  });
  assert.equal(deleteAdministrator.status, 409);

  const rejectedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.org', password: 'incorrecta-123' })
  });
  assert.equal(rejectedLogin.status, 401);

  const acceptedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.org', password: 'uma-senha-forte-123' })
  });
  assert.equal(acceptedLogin.status, 200);
  const login = await acceptedLogin.json();
  assert.equal(login.user.e, 'admin@example.org');
  assert.equal(login.user.pf, 'Administrador');
  assert.equal(login.mustChangePassword, false);

  const forbiddenReset = await fetch(`${baseUrl}/api/users/password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'staff@example.org' })
  });
  assert.equal(forbiddenReset.status, 401);

  const demoteLastAdministrator = await fetch(`${baseUrl}/api/users/access`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${created.token}`
    },
    body: JSON.stringify({ email: 'admin@example.org', profile: 'Médico', status: 'Activa' })
  });
  assert.equal(demoteLastAdministrator.status, 409);

  const addUser = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...savedState, users: [...savedState.users, {
      n: 'Funcionário', e: 'staff@example.org', pf: 'Recepção', st: 'Activa'
    }] })
  });
  assert.equal(addUser.status, 200);

  const updateAccess = await fetch(`${baseUrl}/api/users/access`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${created.token}`
    },
    body: JSON.stringify({ email: 'staff@example.org', profile: 'Médico', status: 'Activa' })
  });
  assert.equal(updateAccess.status, 200);

  const reset = await fetch(`${baseUrl}/api/users/password/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${created.token}`
    },
    body: JSON.stringify({ email: 'STAFF@example.org' })
  });
  assert.equal(reset.status, 200);
  const resetResult = await reset.json();
  assert.equal(typeof resetResult.temporaryPassword, 'string');
  assert.ok(resetResult.temporaryPassword.length >= 20);

  const temporaryLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'staff@example.org', password: resetResult.temporaryPassword })
  });
  assert.equal(temporaryLogin.status, 200);
  const temporarySession = await temporaryLogin.json();
  assert.equal(temporarySession.mustChangePassword, true);
  assert.equal(temporarySession.user.pf, 'Médico');

  const beforeSecondUser = await (await fetch(`${baseUrl}/api/state`, { headers: authHeaders() })).json();
  const addSecondUser = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      ...beforeSecondUser,
      users: [...beforeSecondUser.users, {
        n: 'Segundo funcionário', e: 'second@example.org', pf: 'Médico', st: 'Activa'
      }]
    })
  });
  assert.equal(addSecondUser.status, 200);
  const forgedRoleState = await (await fetch(`${baseUrl}/api/state`, { headers: authHeaders() })).json();
  forgedRoleState.users.find((user) => user.e === 'staff@example.org').pf = 'Administrador';
  const forgedRole = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(forgedRoleState)
  });
  assert.equal(forgedRole.status, 200);

  const nonAdminReset = await fetch(`${baseUrl}/api/users/password/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${temporarySession.token}`
    },
    body: JSON.stringify({ email: 'second@example.org' })
  });
  assert.equal(nonAdminReset.status, 403);

  const wrongCurrentPassword = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${temporarySession.token}`
    },
    body: JSON.stringify({
      currentPassword: 'palavra-passe-errada',
      newPassword: 'nova-palavra-passe-segura-123'
    })
  });
  assert.equal(wrongCurrentPassword.status, 401);

  const changedPassword = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${temporarySession.token}`
    },
    body: JSON.stringify({
      currentPassword: resetResult.temporaryPassword,
      newPassword: 'nova-palavra-passe-segura-123'
    })
  });
  assert.equal(changedPassword.status, 200);

  const updatedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'staff@example.org', password: 'nova-palavra-passe-segura-123' })
  });
  assert.equal(updatedLogin.status, 200);
  assert.equal((await updatedLogin.json()).mustChangePassword, false);

  const repeatedSetup = await fetch(`${baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Outro admin', email: 'outro@example.org', password: 'uma-senha-forte-123' })
  });
  assert.equal(repeatedSetup.status, 409);
});
