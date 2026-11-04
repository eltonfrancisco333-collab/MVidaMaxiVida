import { randomBytes } from 'node:crypto';
import { ApiError } from '../utils/errors.js';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class FirstRunService {
  constructor(stateService, credentialRepository) {
    this.stateService = stateService;
    this.credentialRepository = credentialRepository;
    this.pendingSetup = Promise.resolve();
    this.sessions = new Map();
  }

  createAdministrator(input) {
    const operation = this.pendingSetup.catch(() => {}).then(async () => {
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
      const password = typeof input?.password === 'string' ? input.password : '';

      if (name.length < 2 || name.length > 120) throw new ApiError(400, 'Indique o nome do administrador.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Indique um e-mail válido.');
      if (password.length < 10 || password.length > 200) {
        throw new ApiError(400, 'A palavra-passe deve ter entre 10 e 200 caracteres.');
      }

      const { state } = await this.stateService.getState();
      if (state.users.length) throw new ApiError(409, 'O sistema já foi configurado.');
      if (await this.credentialRepository.hasCredentials()) {
        throw new ApiError(409, 'O sistema já foi configurado.');
      }

      const user = {
        n: name,
        e: email,
        pf: 'Administrador',
        st: 'Activa',
        authManaged: true,
        protectedAdministrator: true
      };
      await this.credentialRepository.set(email, password, { role: 'Administrador', protectedAdministrator: true });
      await this.stateService.saveState({ ...state, users: [user] });
      return this.createSession(user, false);
    });
    this.pendingSetup = operation.catch(() => {});
    return operation;
  }

  async authenticate(input) {
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    const { state } = await this.stateService.getState();
    const user = state.users.find((candidate) => candidate.e.toLowerCase() === email);
    if (!user || user.st !== 'Activa' || !(await this.credentialRepository.verify(email, password))) {
      throw new ApiError(401, 'E-mail ou palavra-passe incorrectos.');
    }
    const role = await this.credentialRepository.getRole(email);
    return this.createSession(
      {
        ...user,
        ...(role ? { pf: role } : {}),
        protectedAdministrator: await this.credentialRepository.isProtectedAdministrator(email)
      },
      await this.credentialRepository.mustChangePassword(email)
    );
  }

  createSession(user, mustChangePassword) {
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { email: user.e.toLowerCase(), expiresAt: Date.now() + SESSION_TTL_MS });
    return { user, token, mustChangePassword };
  }

  async getSession(token) {
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      throw new ApiError(401, 'A sessão expirou. Inicie sessão novamente.');
    }
    const { email } = session;
    const { state } = await this.stateService.getState();
    const user = state.users.find((candidate) => candidate.e.toLowerCase() === email && candidate.st === 'Activa');
    if (!user) {
      this.sessions.delete(token);
      throw new ApiError(401, 'A conta está inactiva. Inicie sessão novamente.');
    }
    const role = await this.credentialRepository.getRole(email);
    return {
      ...user,
      ...(role ? { pf: role } : {}),
      protectedAdministrator: await this.credentialRepository.isProtectedAdministrator(email)
    };
  }

  async changePassword(token, input) {
    const user = await this.getSession(token);
    const currentPassword = typeof input?.currentPassword === 'string' ? input.currentPassword : '';
    const newPassword = typeof input?.newPassword === 'string' ? input.newPassword : '';
    if (newPassword.length < 10 || newPassword.length > 200) {
      throw new ApiError(400, 'A nova palavra-passe deve ter entre 10 e 200 caracteres.');
    }
    if (currentPassword === newPassword) {
      throw new ApiError(400, 'A nova palavra-passe deve ser diferente da actual.');
    }
    if (!(await this.credentialRepository.verify(user.e.toLowerCase(), currentPassword))) {
      throw new ApiError(401, 'A palavra-passe actual está incorrecta.');
    }
    await this.credentialRepository.set(user.e.toLowerCase(), newPassword);
    this.revokeSessions(user.e.toLowerCase());
    return this.createSession(user, false);
  }

  async resetUserPassword(token, input) {
    const administrator = await this.getSession(token);
    if (administrator.pf !== 'Administrador') {
      throw new ApiError(403, 'Apenas um administrador pode repor palavras-passe.');
    }
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const { state } = await this.stateService.getState();
    const user = state.users.find((candidate) => candidate.e.toLowerCase() === email);
    if (!user) throw new ApiError(404, 'Utilizador não encontrado.');
    if (user.st !== 'Activa') throw new ApiError(409, 'Não é possível repor a palavra-passe de uma conta desactivada.');
    if (email === administrator.e.toLowerCase()) {
      throw new ApiError(409, 'Altere a sua própria palavra-passe através do perfil.');
    }

    const temporaryPassword = randomBytes(18).toString('base64url');
    user.authManaged = true;
    await this.stateService.saveState(state);
    const role = await this.credentialRepository.getRole(email) || user.pf;
    await this.credentialRepository.set(email, temporaryPassword, { mustChangePassword: true, role });
    this.revokeSessions(email);
    return { temporaryPassword };
  }

  async updateUserAccess(token, input) {
    const administrator = await this.getSession(token);
    if (administrator.pf !== 'Administrador') {
      throw new ApiError(403, 'Apenas um administrador pode alterar o acesso dos utilizadores.');
    }
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const profile = typeof input?.profile === 'string' ? input.profile : '';
    const status = typeof input?.status === 'string' ? input.status : '';
    if (!['Administrador', 'Recepção', 'Médico'].includes(profile)) {
      throw new ApiError(400, 'Seleccione um perfil de acesso válido.');
    }
    if (!['Activa', 'Desactivada'].includes(status)) {
      throw new ApiError(400, 'Seleccione um estado de conta válido.');
    }
    const { state } = await this.stateService.getState();
    const user = state.users.find((candidate) => candidate.e.toLowerCase() === email);
    if (!user) throw new ApiError(404, 'Utilizador não encontrado.');
    if (await this.credentialRepository.isProtectedAdministrator(email)
      && (profile !== 'Administrador' || status !== 'Activa')) {
      throw new ApiError(409, 'A conta principal do administrador não pode ser desactivada nem removida.');
    }
    if (email === administrator.e.toLowerCase()
      && (profile !== 'Administrador' || status !== 'Activa')) {
      throw new ApiError(409, 'Não pode desactivar nem remover o seu próprio perfil de administrador.');
    }
    user.pf = profile;
    user.st = status;
    let activeAdministratorCount = 0;
    for (const candidate of state.users) {
      const candidateRole = candidate.e.toLowerCase() === email
        ? profile
        : await this.credentialRepository.getRole(candidate.e.toLowerCase()) || candidate.pf;
      const candidateStatus = candidate.e.toLowerCase() === email ? status : candidate.st;
      if (candidateRole === 'Administrador' && candidateStatus === 'Activa') activeAdministratorCount += 1;
    }
    if (!activeAdministratorCount) {
      throw new ApiError(409, 'O sistema precisa de pelo menos um administrador activo.');
    }
    await this.stateService.saveState(state);
    await this.credentialRepository.setRole(email, profile);
    if (status !== 'Activa') {
      this.revokeSessions(email);
    }
    return user;
  }

  async assertProtectedAdministratorRetained(nextState) {
    const email = await this.credentialRepository.getProtectedAdministratorEmail();
    if (!email) return;
    if (!nextState.users.some((user) => typeof user?.e === 'string' && user.e.toLowerCase() === email)) {
      throw new ApiError(409, 'A conta principal do administrador não pode ser eliminada.');
    }
  }

  async logout(token) {
    if (!this.sessions.delete(token)) throw new ApiError(401, 'A sessão expirou. Inicie sessão novamente.');
    return { success: true };
  }

  revokeSessions(email) {
    for (const [sessionToken, session] of this.sessions) {
      if (session.email === email) this.sessions.delete(sessionToken);
    }
  }
}
