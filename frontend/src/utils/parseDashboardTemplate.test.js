import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgePath = path.join(projectDirectory, 'frontend', 'public', 'mvida-api-bridge.js');
const dashboardPath = path.join(projectDirectory, 'frontend', 'public', 'dashboard.html');

test('the login flow preserves the authenticated user while loading authorized state', async () => {
  const bridge = await readFile(bridgePath, 'utf8');
  const loginHandler = bridge.slice(
    bridge.indexOf("const address = email.value.trim().toLowerCase();"),
    bridge.indexOf('\n    };', bridge.indexOf("const address = email.value.trim().toLowerCase();"))
  );
  const stateLoader = bridge.slice(
    bridge.indexOf('async function loadAuthenticatedState()'),
    bridge.indexOf('\n  async function connect()', bridge.indexOf('async function loadAuthenticatedState()'))
  );

  assert.match(loginHandler, /await loadAuthenticatedState\(\);[\s\S]*?entrar\(result\.user\);/);
  assert.doesNotMatch(loginHandler, /entrar\(USER\);/);
  assert.doesNotMatch(stateLoader, /\bUSER\s*=\s*null\b/);
});

test('the dashboard follows the completed-consultation payment workflow', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /appointment\.st!=='Concluída'[\s\S]{0,40}return payment/);
  assert.match(dashboard, /Diagnóstico<textarea/);
  assert.match(dashboard, /paymentDetailsValid/);
  assert.match(dashboard, /Só a recepção ou o administrador podem registar pagamentos/);
  assert.match(dashboard, /receiptNumber\|\|/);
});

test('consultations and payments only confirm after persistence and roll back on failure', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const consultationCompletion = dashboard.slice(
    dashboard.indexOf("form('Actualizar estado da consulta'"),
    dashboard.indexOf("\n    return", dashboard.indexOf("form('Actualizar estado da consulta'"))
  );
  const paymentRegistration = dashboard.slice(
    dashboard.indexOf('const ppg=i=>'),
    dashboard.indexOf('const npg=()=>', dashboard.indexOf('const ppg=i=>'))
  );
  const newPaymentRegistration = dashboard.slice(
    dashboard.indexOf('const npg=()=>'),
    dashboard.indexOf('const htmlSafe=', dashboard.indexOf('const npg=()=>'))
  );

  assert.match(consultationCompletion, /await window\.mvidaAuth\.saveState\(\)/);
  assert.match(consultationCompletion, /catch\(error\)\{[\s\S]*?Object\.assign\(x,previousAppointment\)/);
  assert.match(paymentRegistration, /await window\.mvidaAuth\.saveState\(\)/);
  assert.match(paymentRegistration, /catch\(error\)\{Object\.assign\(current,previous\)/);
  assert.match(newPaymentRegistration, /await window\.mvidaAuth\.saveState\(\)/);
  assert.match(newPaymentRegistration, /catch\(error\)\{Object\.assign\(x,previous\)/);
});

test('payment registration refreshes server state and links a unique completed legacy consultation', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');
  const paymentWorkflow = dashboard.slice(
    dashboard.indexOf('const legacyAppointmentForPayment='),
    dashboard.indexOf('const htmlSafe=', dashboard.indexOf('const legacyAppointmentForPayment='))
  );

  assert.match(bridge, /refreshState:\s*loadAuthenticatedState/);
  assert.match(paymentWorkflow, /await window\.mvidaAuth\.refreshState\(\)/);
  assert.match(paymentWorkflow, /const linkLegacyPaymentToAppointment=payment=>/);
  assert.match(paymentWorkflow, /payment\.appointmentId=appointment\.id/);
  assert.match(paymentWorkflow, /appointment\.st!=='Concluída'/);
  assert.match(paymentWorkflow, /A consulta associada ainda não está concluída/);
});

test('presentation mutations do not trigger repeated saves and reception cannot submit clinical fields', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');
  const observer = bridge.slice(
    bridge.indexOf('new MutationObserver('),
    bridge.indexOf('document.body.classList.add', bridge.indexOf('new MutationObserver('))
  );
  const patientForm = dashboard.slice(
    dashboard.indexOf('const fpa='),
    dashboard.indexOf('const okpa=', dashboard.indexOf('const fpa='))
  );

  assert.match(observer, /JSON\.stringify\(stateSnapshot\(\)\)\s*!==\s*lastObservedState/);
  assert.match(bridge, /lastObservedState = JSON\.stringify\(stateSnapshot\(\)\)/);
  assert.match(patientForm, /\$\{ADM\(\)\?sc\('Clínico'/);
  assert.match(patientForm, /\.\.\.\(ADM\(\)\?\{al:V\('f_al'\)\|\|'Não registadas',tb:\$\('f_tb'\)\.value\}:\{\}\)/);
});

test('queued state saves send the exact snapshot captured when the save was requested', async () => {
  const bridge = await readFile(bridgePath, 'utf8');
  const saveState = bridge.slice(
    bridge.indexOf('async function saveState()'),
    bridge.indexOf('\n  function scheduleSave()', bridge.indexOf('async function saveState()'))
  );

  assert.match(saveState, /const body = JSON\.stringify\(stateSnapshot\(\)\)/);
  assert.match(saveState, /saveQueue\.catch\(\(\) => \{\}\)\.then\(async \(\) => \{\s*if \(body === lastSaved\) return/);
  assert.match(saveState, /body: JSON\.stringify\(\{\s*\.\.\.JSON\.parse\(body\), _revision: stateRevision\s*\}\)/);
  assert.doesNotMatch(saveState, /const currentBody = JSON\.stringify\(stateSnapshot\(\)\)/);
  assert.doesNotMatch(saveState, /currentBody/);
  assert.match(saveState, /JSON\.stringify\(stateSnapshot\(\)\) === body/);
  assert.match(bridge, /lastObservedState = stateUnchanged \? savedBody : JSON\.stringify\(stateSnapshot\(\)\)/);
  assert.match(bridge, /async function completeAppointment\(appointmentId, clinicalNote\)/);
  assert.match(bridge, /fetch\('\/api\/appointments\/complete'/);
});

test('payment management distinguishes invalid records from completed refunds', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /st==='Estornado'/);
  assert.match(dashboard, /refund-confirm/);
  assert.match(dashboard, /refund-date/);
  assert.match(dashboard, /refund-method/);
  assert.match(dashboard, /refund-reference/);
  assert.match(dashboard, /ESTORNADO/);
  assert.match(dashboard, /status==='Estornado'/);
});

test('the dashboard displays automatic patient process number generation', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');

  assert.match(dashboard, /O número de processo é gerado automaticamente/);
  assert.match(dashboard, /PA\.push\(d\)/);
  assert.doesNotMatch(dashboard, /id:'f_p'/);
  assert.match(bridge, /savedBody = JSON\.stringify\(stateSnapshot\(\)\)/);
});

test('the calendar Today button opens the current Maputo day', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /id="ch" type="button">Hoje/);
  assert.match(dashboard, /cur=clinicClock\(\)\.date;cm='dia';rcal\(\)/);
});

test('account menu offers password change and logout with a five-character minimum', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /id="account-change-password"[^>]*>[\s\S]*?Alterar palavra-passe/);
  assert.match(dashboard, /id="account-logout"[^>]*>[\s\S]*?Terminar sessão/);
  assert.match(dashboard, /openPasswordChange\(false\)/);
  assert.match(dashboard, /Nova palavra-passe \(mínimo 5 caracteres\)/i);
  assert.match(dashboard, /newPassword\.length<5/);
  assert.match(dashboard, /canReset=ADM\(\)&&x\.e\.toLowerCase\(\)!==USER\.e\.toLowerCase\(\)/);
});

test('the login and dashboard use blue without leftover green accents', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');

  assert.match(dashboard, /:root\{[^}]*--g:#246b9e/);
  assert.match(dashboard, /:root\[data-theme="dark"\]\{[^}]*--bg:#0b1522;--card:#142337/);
  assert.match(dashboard, /--success:#315f87;--success-bg:#e8f1f8/);
  assert.match(dashboard, /--success:#9bc4e7;--success-bg:#1b2c40/);
  assert.match(dashboard, /\.lgl\{background:radial-gradient\(circle at 82% 18%,rgba\(117,175,224/);
  assert.match(dashboard, /\.ev\.g\{background:#dbeafe;color:#1d4ed8\}/);
  assert.doesNotMatch(
    dashboard,
    /#(?:0d2b23|113f32|134f3a|144e3a|157a40|193b31|287453|44bf7b|70c49a|72d99a|8ae1ae|b6efc9|b8f3c8|c6f5d9|dcf5e5|e9f8ef|edf6f1|effff7)\b|rgba\(17,30,25/i
  );
  assert.match(dashboard, /\.dtb th\{color:#315f87/);
  assert.match(dashboard, /\.d1\{[^}]*linear-gradient\(135deg,#246b9e,#1b4a70\)/);
  assert.match(dashboard, /\.dlogo b\{[^}]*color:#123353/);
  assert.match(dashboard, /BL=\[36,107,158\],GR=\[91,111,140\]/);
  assert.match(dashboard, /class="login-highlights"/);
  assert.match(bridge, /title\.textContent = 'Aceder à sua conta'/);
  assert.match(dashboard, /data-login-label="email">E-mail/);
  assert.match(dashboard, /data-login-label="password">Palavra-passe/);
  assert.match(dashboard, /@media\(max-width:820px\)\{\.lgx\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(bridge, /emailLabel\.textContent = 'E-mail do administrador'/);
  assert.match(bridge, /form\.insertBefore\(nameField, email\.closest\('\.login-field'\)/);
});

test('empty consultation lists do not show table headers without appointments', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /\.consultation-list:empty\{display:none!important\}/);
  assert.match(dashboard, /function tbl\(id,heads,rows,N,hideEmpty\)\{N=N\|\|6;if\(hideEmpty&&!rows\.length\)\{PG0\[id\]=0;\$\(id\)\.innerHTML='';return\}/);
  assert.match(dashboard, /function renderAppointmentEmpty\(id,title,description,buttonLabel,onClick\)/);
  assert.match(dashboard, /Sem consultas para hoje/);
  assert.match(dashboard, /Sem agendamentos futuros/);
  assert.match(dashboard, /Nova consulta',nco\)/);
  assert.match(dashboard, /else renderAppointmentEmpty\('tco3'/);
  assert.match(dashboard, /else renderAppointmentEmpty\('tco2'/);
});

test('table search stays beside each table and filters results as the user types', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const tableRenderer = dashboard.slice(
    dashboard.indexOf('const tableTools='),
    dashboard.indexOf('\nfunction lab()', dashboard.indexOf('const tableTools='))
  );
  const serviceRenderer = dashboard.slice(
    dashboard.indexOf('function renderServices()'),
    dashboard.indexOf('\nconst deleteService=', dashboard.indexOf('function renderServices()'))
  );

  assert.match(tableRenderer, /tableTools\(id,filtered\.length\)/);
  assert.match(tableRenderer, /data-table-search="\$\{id\}"/);
  assert.match(tableRenderer, /filterTableRows\(id,rows\)/);
  assert.match(tableRenderer, /addEventListener\('input',event=>\{const input=event\.target\.closest\('\[data-table-search\]'\)/);
  assert.match(serviceRenderer, /data-table-search="tsvc"/);
  assert.match(serviceRenderer, /filteredRows=query\?rows\.filter/);
  assert.doesNotMatch(dashboard, /id="global-search"/);
});

test('service actions use the shared icon controls and open the redesigned detail view', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const serviceRenderer = dashboard.slice(
    dashboard.indexOf('function renderServices()'),
    dashboard.indexOf('\nconst deleteService=', dashboard.indexOf('function renderServices()'))
  );

  assert.match(serviceRenderer, /serviceAction\('view','Ver detalhes','eye'/);
  assert.match(serviceRenderer, /serviceAction\('edit','Editar serviço','pencil'/);
  assert.match(serviceRenderer, /serviceAction\('delete','Eliminar serviço','trash-2'/);
  assert.match(serviceRenderer, /dm\('Detalhes do Serviço'/);
  assert.match(dashboard, /\.dp\{display:grid/);
  assert.match(dashboard, /\.dt-panel\{padding:18px/);
});

test('dark mode gives edit fields readable contrast', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /:root\[data-theme="dark"\] \.busca,:root\[data-theme="dark"\] \.sel,:root\[data-theme="dark"\] textarea\{background:#1a2e43;border-color:var\(--bd\);color:var\(--tx\)\}/);
  assert.match(dashboard, /:root\[data-theme="dark"\] \.busca:disabled,:root\[data-theme="dark"\] textarea:disabled\{background:#142337;color:#a9bacb\}/);
});

test('diagnosis validation and save failures use accessible popups', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');

  assert.match(dashboard, /const showFormError=message=>popup\(message\)/);
  assert.match(dashboard, /role','alertdialog'/);
  assert.match(dashboard, /Para concluir a consulta, preencha o diagnóstico com pelo menos 3 caracteres\./);
  assert.doesNotMatch(dashboard, /toast\('Registe o diagnóstico antes de concluir a consulta\.'/);
  assert.match(bridge, /window\.mvidaNotify\(message\)/);
});

test('doctors can conclude a scheduled or in-progress consultation with a diagnosis', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const doctorWorkflow = dashboard.slice(
    dashboard.indexOf('const eco=i=>'),
    dashboard.indexOf('const nco=()=>', dashboard.indexOf('const eco=i=>'))
  );
  const doctorCompletion = doctorWorkflow.slice(
    doctorWorkflow.indexOf("if(isDoctor()){"),
    doctorWorkflow.indexOf("\n  const reception=", doctorWorkflow.indexOf("if(isDoctor()){"))
  );

  assert.match(doctorCompletion, /x\.st==='Agendada'\?\['','Em curso','Concluída','Cancelada'\]:\['','Concluída','Cancelada'\]/);
  assert.match(doctorCompletion, /id="f_diagnosis-section" style="display:none">Diagnóstico/);
  assert.match(doctorCompletion, /if\(status==='Concluída'\)await window\.mvidaAuth\.completeAppointment\(x\.id,note\)/);
  assert.match(doctorCompletion, /else await window\.mvidaAuth\.saveState\(\)/);
  assert.match(doctorCompletion, /f_diagnosis-section.*style\.display=\$\('f_s'\)\.value==='Concluída'/);
  assert.match(doctorCompletion, /popup\(error\.message\|\|'Não foi possível concluir a consulta\.'/);
  assert.doesNotMatch(doctorCompletion, /toast\(status==='Concluída'/);
});

test('dark mode keeps dashboard headings and primary report actions readable', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /:root\[data-theme="dark"\]\{[^}]*--action:#246b9e/);
  assert.match(dashboard, /\.btn\{[^}]*background:var\(--action,var\(--g\)\);color:#fff/);
  assert.match(dashboard, /\.sg\.on\{[^}]*background:var\(--action,var\(--g\)\);color:#fff/);
  assert.match(dashboard, /:root\[data-theme="dark"\] \.ht,:root\[data-theme="dark"\] \.ph2\{color:var\(--tx\)\}/);
  assert.match(dashboard, /:root\[data-theme="dark"\] \.hdt\{color:var\(--bl\)\}/);
  assert.match(dashboard, /id="gr"[^>]*>[\s\S]*?Gerar Relatório/);
});

test('notifications are generated from appointments and outstanding payments', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const bridge = await readFile(bridgePath, 'utf8');

  assert.match(dashboard, /\.bell b\{display:none/);
  assert.match(dashboard, /aria-controls="np" aria-expanded="false"/);
  assert.match(dashboard, /function notificationItems\(\)/);
  assert.match(dashboard, /Consulta por actualizar/);
  assert.match(dashboard, /Consulta agendada para hoje/);
  assert.match(dashboard, /payment\.st!=='Pendente'\|\|!paymentReady\(payment\)/);
  assert.match(dashboard, /Tratamento com pagamento pendente/);
  assert.match(dashboard, /mvida-notifications-read:/);
  assert.match(dashboard, /window\.setInterval\(renderNotifications,60_000\)/);
  assert.match(dashboard, /Marcar todas como lidas/);
  assert.match(dashboard, /data-notification-page="\$\{item\.page\}"/);
  assert.match(bridge, /new Event\('mvida:state-loaded'\)/);
  assert.match(dashboard, /b\.setAttribute\('aria-expanded',String\(show\)\)/);
});

test('notification generation respects appointment status and user profile', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const start = dashboard.indexOf('function notificationItems()');
  const end = dashboard.indexOf('\nconst notificationStorageKey', start);
  assert.ok(start >= 0 && end > start, 'notification generator should be available');
  const generator = dashboard.slice(start, end);
  const appointments = [
    { id: 'past', d: '2026-11-04', h: '09:00', pac: 'Paciente A', med: 'Dra. Um', st: 'Agendada' },
    { id: 'today-later', d: '2026-11-05', h: '11:00', pac: 'Paciente B', med: 'Dra. Um', st: 'Agendada' },
    { id: 'today-past', d: '2026-11-05', h: '09:00', pac: 'Paciente C', med: 'Dr. Dois', st: 'Em curso' },
    { id: 'done', d: '2026-11-05', h: '08:00', pac: 'Paciente D', med: 'Dra. Um', st: 'Concluída' },
    { id: 'cancelled', d: '2026-11-04', h: '08:00', pac: 'Paciente E', med: 'Dra. Um', st: 'Cancelada' }
  ];
  const payments = [
    { id: 1, kind: 'Consulta', appointmentId: 'done', pac: 'Paciente D', ds: 'Consulta de teste', v: 500 },
    { id: 2, kind: 'Tratamento', pac: 'Paciente F', ds: 'Tratamento de teste', v: 700 },
    { id: 3, kind: 'Tratamento', pac: 'Paciente G', ds: 'Tratamento pago', v: 900, st: 'Pago' }
  ];
  const buildNotifications = (profile, name) => vm.runInNewContext(`(${generator})()`, {
    USER: { pf: profile, n: name },
    MUST_CHANGE_PASSWORD: false,
    CO: appointments,
    PG: payments.map((payment) => ({ st: 'Pendente', ...payment })),
    clinicClock: () => ({ date: '2026-11-05', time: '10:00' }),
    ownAppointment: (appointment) => profile !== 'Médico' || appointment.med === name,
    br: (date) => date,
    mt: (amount) => `${amount} MT`,
    paymentReady: (payment) => payment.kind === 'Tratamento'
      || (payment.kind === 'Consulta' && appointments.some((appointment) => (
        appointment.id === payment.appointmentId && appointment.st === 'Concluída'
      )))
  });

  const administratorNotifications = buildNotifications('Administrador', 'Admin');
  assert.deepEqual(Array.from(administratorNotifications, ({ title }) => title).sort(), [
    'Consulta agendada para hoje',
    'Consulta por actualizar',
    'Consulta por actualizar',
    'Consulta concluída com pagamento pendente',
    'Tratamento com pagamento pendente'
  ].sort());

  const doctorNotifications = buildNotifications('Médico', 'Dra. Um');
  assert.equal(doctorNotifications.some(({ description }) => description.includes('Paciente C')), false);
  assert.equal(doctorNotifications.some(({ title }) => title.includes('pagamento')), false);

  const financeNotifications = buildNotifications('Financeiro', 'Financeiro');
  assert.equal(financeNotifications.length, 2);
  assert.equal(financeNotifications.every(({ page }) => page === 'Pagamentos'), true);
});

test('the services page lets administrators configure prices for every specialty', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /rows\.push\(\{name:'Consulta',category:'Consultas',specialty/);
  assert.match(dashboard, /DEFAULT_SERVICE_CATALOG=\[/);
  assert.match(dashboard, /\['Hemograma completo','Exames e diagnóstico laboratorial','Laboratório',500\]/);
  assert.match(dashboard, /\['Ecocardiograma','Imagiologia','Cardiologia',2500\]/);
  assert.match(dashboard, /\['Sessão de fisioterapia','Fisioterapia e reabilitação','Fisioterapia',800\]/);
  assert.match(dashboard, /\['Extracção dentária','Odontologia','Odontologia',1000\]/);
  assert.match(dashboard, /bsvc-catalog/);
  assert.match(dashboard, /category:service\.category\|\|'Outros serviços'/);
  assert.match(dashboard, /<th>Categoria<\/th>/);
  assert.match(dashboard, /const value=service\.price/);
  assert.match(dashboard, /id="f_v" type="number" disabled/);
  assert.match(dashboard, /serviceAction\('price','Definir preço','pencil'/);
  assert.match(dashboard, /serviceAction\('delete','Eliminar serviço','trash-2'/);
  assert.match(dashboard, /serviceAction\('toggle'/);
  assert.match(dashboard, /data-service-action/);
  assert.match(dashboard, /Preço indisponível em Serviços/);
  assert.match(dashboard, /consultationPrice\(doctor\)>0/);
  assert.match(dashboard, /serviceIsReferenced/);
  assert.match(dashboard, /service-page/);
});

test('new employee forms use distinct sections and consistent centred dialogs', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const employeeForm = dashboard.slice(dashboard.indexOf('const nfu=()=>'), dashboard.indexOf('const dfu=', dashboard.indexOf('const nfu=()=>')));

  assert.match(employeeForm, /staff-form/);
  assert.match(employeeForm, /Dados pessoais/);
  assert.match(employeeForm, /Contacto/);
  assert.match(employeeForm, /Função e departamento/);
  assert.match(employeeForm, /Telefone alternativo \(opcional\)/);
  assert.match(dashboard, /\.ov \.md\.alert-dialog\{width:min\(520px,100%\);text-align:center\}/);
  assert.match(dashboard, /modal\.className='md alert-dialog'/);
  assert.match(dashboard, /body\.className='alert-message'/);
  assert.match(dashboard, /justify-content:center;gap:10px/);
});

test('the consultations page provides a today view using the Maputo date', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /data-c="today"/);
  assert.match(dashboard, /id="tco3"/);
  assert.match(dashboard, /crows\(x=>String\(x\.d\|\|''\)\.slice\(0,10\)===TODAY\)/);
  assert.match(dashboard, /RR\.tco1=RR\.tco2=RR\.tco3=rco/);
});

test('the dashboard preserves appointment reasons and reports only received payments', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /mo:V\('f_mo'\)/);
  assert.match(dashboard, /htmlSafe\(x\.mo\)/);
  assert.match(dashboard, /Pagamentos concluídos com data efectiva registada dentro do período/);
  assert.match(dashboard, /x\.st==='Pago'&&typeof x\.paidAt==='string'&&inP\(x\.paidAt\.slice\(0,10\)\)/);
  assert.match(dashboard, /reportPayments=ty==='pagamentos'\?received:pg/);
});

test('the dashboard navigation and dialogs support keyboard and screen-reader access', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /a\.setAttribute\('role','button'\);a\.tabIndex=0/);
  assert.match(dashboard, /event\.key==='Enter'\|\|event\.key===' '/);
  assert.match(dashboard, /aria-labelledby','gt'/);
  assert.match(dashboard, /event\.key==='Escape'/);
  assert.match(dashboard, /event\.shiftKey&&document\.activeElement===first/);
});

test('the dashboard still starts if optional third-party icons are unreachable', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const loader = await readFile(path.join(projectDirectory, 'frontend', 'src', 'components', 'LegacyDashboard.jsx'), 'utf8');

  assert.doesNotMatch(dashboard, /jspdf\.umd\.min\.js/);
  assert.match(loader, /import\('jspdf'\)/);
  assert.match(dashboard, /window\.mvidaPdfLoader\(\)\.then\(\(\)=>pdfDoc\(c\)\)/);
  assert.match(loader, /source\.startsWith\('https:\/\/'\)\) resolve\(\)/);
});
