import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initialState, preventDeletingLinkedRecords, validateState } from '../domain/state.js';
import { ApiError } from '../utils/errors.js';

export class StateRepository {
  constructor(dataFile) {
    this.dataFile = dataFile;
    this.value = structuredClone(initialState);
    this.persisted = false;
    this.writes = Promise.resolve();
    this.ready = this.load();
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.dataFile, 'utf8'));
      validateState(saved);
      this.value = saved;
      this.persisted = true;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  async get() {
    await this.ready;
    return { state: structuredClone(this.value), persisted: this.persisted };
  }

  async save(nextState, { migration = false } = {}) {
    const write = this.writes.catch(() => {}).then(async () => {
      await this.ready;
      if (migration && this.persisted) {
        throw new ApiError(409, 'O servidor já tem dados guardados; a migração foi cancelada.');
      }

      validateState(nextState);
      if (!migration && this.persisted) preventDeletingLinkedRecords(this.value, nextState);

      await mkdir(path.dirname(this.dataFile), { recursive: true });
      const temporaryFile = `${this.dataFile}.${process.pid}.tmp`;
      await writeFile(temporaryFile, JSON.stringify(nextState, null, 2), 'utf8');
      await rename(temporaryFile, this.dataFile);
      this.value = structuredClone(nextState);
      this.persisted = true;
      return structuredClone(this.value);
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
