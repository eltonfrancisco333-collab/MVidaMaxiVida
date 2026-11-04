import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { createRouter } from './routes/index.js';
import { StateRepository } from './repositories/stateRepository.js';
import { StateService } from './services/stateService.js';
import { FirstRunService } from './services/firstRunService.js';
import { CredentialRepository } from './repositories/credentialRepository.js';
import { handleApiError } from './middlewares/errorHandler.js';
import { serveFrontend } from './middlewares/staticFrontend.js';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApiServer({
  dataFile = env.dataFile,
  credentialsFile = env.credentialsFile,
  staticDirectory = path.resolve(backendDirectory, '../dist')
} = {}) {
  const stateRepository = new StateRepository(dataFile);
  const stateService = new StateService(stateRepository);
  const firstRunService = new FirstRunService(stateService, new CredentialRepository(credentialsFile));
  const route = createRouter(stateService, firstRunService);

  return createServer(async (request, response) => {
    try {
      if (request.url.startsWith('/api/')) {
        await route(request, response);
      } else {
        await serveFrontend(request, response, staticDirectory);
      }
    } catch (error) {
      handleApiError(response, error);
    }
  });
}
