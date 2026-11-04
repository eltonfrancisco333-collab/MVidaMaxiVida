import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

test('the services page lets administrators configure prices for every specialty', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /rows\.push\(\{name:'Consulta',specialty/);
  assert.match(dashboard, /svc-consultation-add/);
  assert.match(dashboard, /Definir preço/);
  assert.match(dashboard, /Q\('\.svc-consultation-add'\)/);
  assert.match(dashboard, /svc-delete/);
  assert.match(dashboard, /serviceIsReferenced/);
  assert.match(dashboard, /service-page/);
});

test('the consultations page provides a today view using the Maputo date', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');

  assert.match(dashboard, /data-c="today"/);
  assert.match(dashboard, /id="tco3"/);
  assert.match(dashboard, /crows\(x=>String\(x\.d\|\|''\)\.slice\(0,10\)===TODAY\)/);
  assert.match(dashboard, /RR\.tco1=RR\.tco2=RR\.tco3=rco/);
});
