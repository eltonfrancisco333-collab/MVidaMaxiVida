import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgePath = path.join(projectDirectory, 'frontend', 'public', 'mvida-api-bridge.js');

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
