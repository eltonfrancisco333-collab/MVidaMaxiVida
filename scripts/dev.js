import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '../backend/src/app.js';

const projectDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const frontendDirectory = path.join(projectDirectory, 'frontend');
const apiPort = Number(process.env.API_PORT || 3001);
const apiServer = createApiServer();
let viteProcess;
let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (viteProcess && !viteProcess.killed) viteProcess.kill();
  apiServer.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 3000).unref();
}

apiServer.once('error', (error) => {
  console.error(`Não foi possível iniciar a API em 127.0.0.1:${apiPort}: ${error.message}`);
  process.exitCode = 1;
});

apiServer.listen(apiPort, '127.0.0.1', () => {
  const viteCli = path.join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js');
  viteProcess = spawn(process.execPath, [
    viteCli,
    '--config',
    path.join(frontendDirectory, 'vite.config.js'),
    '--host',
    '0.0.0.0',
    '--port',
    '3000'
  ], {
    cwd: projectDirectory,
    env: process.env,
    stdio: 'inherit'
  });

  viteProcess.once('error', (error) => {
    console.error(`Não foi possível iniciar o frontend: ${error.message}`);
    shutdown(1);
  });
  viteProcess.once('exit', (code) => shutdown(code || 0));
  console.log(`Frontend e API iniciados; API em http://127.0.0.1:${apiPort}`);
});

process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());
