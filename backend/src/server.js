import { createApiServer } from './app.js';
import { env } from './config/env.js';

const server = createApiServer();
server.listen(env.port, env.host, () => {
  console.log(`Sistema MVida disponível em http://${env.host}:${env.port}`);
});
