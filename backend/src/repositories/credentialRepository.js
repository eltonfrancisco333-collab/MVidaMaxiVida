import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export class CredentialRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.credentials = {};
    this.writes = Promise.resolve();
    this.ready = this.load();
  }

  async load() {
    try {
      this.credentials = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  async set(email, password, { mustChangePassword = false, role, protectedAdministrator = false } = {}) {
    await this.ready;
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');
    const write = this.writes.catch(() => {}).then(async () => {
      await this.ready;
      this.credentials[email] = {
        salt,
        hash,
        mustChangePassword,
        role: role || this.credentials[email]?.role,
        protectedAdministrator: protectedAdministrator || this.credentials[email]?.protectedAdministrator === true
      };
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryFile = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryFile, JSON.stringify(this.credentials, null, 2), 'utf8');
      await rename(temporaryFile, this.filePath);
    });
    this.writes = write.catch(() => {});
    await write;
  }

  async verify(email, password) {
    await this.ready;
    const credential = this.credentials[email];
    if (!credential) return false;
    const candidate = Buffer.from(await scrypt(password, credential.salt, 64));
    const expected = Buffer.from(credential.hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  async mustChangePassword(email) {
    await this.ready;
    return this.credentials[email]?.mustChangePassword === true;
  }

  async getRole(email) {
    await this.ready;
    return this.credentials[email]?.role || null;
  }

  async getProtectedAdministratorEmail() {
    await this.ready;
    const marked = Object.entries(this.credentials).find(([, credential]) => credential.protectedAdministrator === true);
    if (marked) return marked[0];
    return Object.entries(this.credentials).find(([, credential]) => credential.role === 'Administrador')?.[0] || null;
  }

  async isProtectedAdministrator(email) {
    return (await this.getProtectedAdministratorEmail()) === email;
  }

  async setRole(email, role) {
    await this.ready;
    if (!this.credentials[email]) return;
    const write = this.writes.catch(() => {}).then(async () => {
      await this.ready;
      this.credentials[email].role = role;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryFile = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryFile, JSON.stringify(this.credentials, null, 2), 'utf8');
      await rename(temporaryFile, this.filePath);
    });
    this.writes = write.catch(() => {});
    await write;
  }

  async hasCredentials() {
    await this.ready;
    return Object.keys(this.credentials).length > 0;
  }
}
