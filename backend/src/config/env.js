import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const env = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || process.env.API_PORT || 3001),
  dataFile: process.env.MVIDA_DATA_FILE || path.join(backendDirectory, 'data', 'mvida-clinic-state.json'),
  credentialsFile: process.env.MVIDA_CREDENTIALS_FILE || path.join(backendDirectory, 'data', 'mvida-credentials.json')
};
