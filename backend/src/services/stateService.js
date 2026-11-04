export class StateService {
  constructor(repository) {
    this.repository = repository;
  }

  async getState() {
    return this.repository.get();
  }

  saveState(state, options) {
    return this.repository.save(state, options);
  }
}
