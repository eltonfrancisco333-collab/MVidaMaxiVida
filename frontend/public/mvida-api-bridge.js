(() => {
  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'status');
  overlay.textContent = 'A ligar ao sistema e a carregar os dados...';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '100',
    display: 'grid',
    placeItems: 'center',
    padding: '24px',
    background: '#f6f8fb',
    color: '#0b4a2c',
    font: '600 14px Inter, sans-serif',
    textAlign: 'center'
  });
  document.body.appendChild(overlay);

  const stateSnapshot = () => ({
    patients: PA,
    employees: FU,
    users: US,
    appointments: CO,
    payments: PG,
    audit: AU,
    reports: RL,
    services: SERVICES
  });
  const collections = Object.keys(stateSnapshot());
  let lastSaved = '';
  let saveTimer;
  let saveQueue = Promise.resolve();
  let authToken = '';
  let systemConfigured = false;

  async function accountRequest(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify(body || {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação da conta.');
    return result;
  }

  window.mvidaAuth = {
    setSession(result) {
      authToken = result.token;
      this.user = result.user;
      MUST_CHANGE_PASSWORD = result.mustChangePassword === true;
    },
    resetPassword(email) {
      return accountRequest('/api/users/password/reset', { email });
    },
    updateAccess(email, profile, status) {
      return accountRequest('/api/users/access', { email, profile, status });
    },
    changePassword(currentPassword, newPassword) {
      return accountRequest('/api/auth/change-password', { currentPassword, newPassword }).then(async (result) => {
        this.setSession(result);
        await loadAuthenticatedState();
        return result;
      });
    },
    saveState,
    logout() {
      return accountRequest('/api/auth/logout');
    },
    clearSession() {
      authToken = '';
      this.user = null;
      MUST_CHANGE_PASSWORD = false;
      PA = [];
      FU = [];
      US = [];
      CO = [];
      PG = [];
      AU = [];
      RL = [];
      SERVICES = [];
      lastSaved = JSON.stringify(stateSnapshot());
      renderSavedState();
    }
  };

  function isCompatibleState(state) {
    return state && collections.every((name) => Array.isArray(state[name]));
  }

  function repairKnownText(value) {
    const replacements = new Map([
      ['N\uFFFDo registadas', 'Não registadas'],
      ['Jo\uFFFDo Manuel Costa', 'João Manuel Costa'],
      ['Cl\uFFFDnica Geral', 'Clínica Geral'],
      ['M\uFFFDdico', 'Médico'],
      ['Ter\uFFFDa', 'Terça'],
      ['Lu\uFFFDsa Ferreira', 'Luísa Ferreira'],
      ['Tom\uFFFDs Machava', 'Tomás Machava'],
      ['T\uFFFDcnico', 'Técnico'],
      ['Laborat\uFFFDrio', 'Laboratório'],
      ['Recep\uFFFD\uFFFDo', 'Recepção'],
      ['Administra\uFFFD\uFFFDo', 'Administração'],
      ['Urg\uFFFDncias', 'Urgências'],
      ['Conclu\uFFFDda', 'Concluída'],
      ['Pagamento m\uFFFDvel', 'Pagamento móvel'],
      ['Cart\uFFFDo', 'Cartão'],
      ['Transfer\uFFFDncia', 'Transferência'],
      ['In\uFFFDcio de sess\uFFFDo', 'Início de sessão'],
      ['Informa\uFFFD\uFFFDo', 'Informação'],
      ['Consulta encerrada com diagn\uFFFDstico', 'Consulta encerrada com diagnóstico'],
      ['Actualiza\uFFFD\uFFFDo de paciente', 'Actualização de paciente'],
      ['C\uFFFDpia de seguran\uFFFDa', 'Cópia de segurança'],
      ['C\uFFFDpia di\uFFFDria conclu\uFFFDda', 'Cópia diária concluída'],
      ['Relat\uFFFDrio Geral', 'Relatório Geral'],
      ['Resumo geral de todas as opera\uFFFD\uFFFDes do sistema.', 'Resumo geral de todas as operações do sistema.'],
      ['Consultas no per\uFFFDodo', 'Consultas no período'],
      ['Funcion\uFFFDrios', 'Funcionários'],
      ['Relat\uFFFDrio de Consultas', 'Relatório de Consultas'],
      ['Consultas realizadas e agendadas no per\uFFFDodo.', 'Consultas realizadas e agendadas no período.'],
      ['Conclu\uFFFDda: 4 \uFFFD Faltou: 1 \uFFFD Cancelada: 1', 'Concluída: 4 · Faltou: 1 · Cancelada: 1'],
      ['Cl\uFFFDnica Geral: 2 \uFFFD Cardiologia: 2 \uFFFD Pediatria: 2', 'Clínica Geral: 2 · Cardiologia: 2 · Pediatria: 2'],
      ['Relat\uFFFDrio de Pagamentos', 'Relatório de Pagamentos'],
      ['Pagamentos recebidos no per\uFFFDodo.', 'Pagamentos recebidos no período.'],
      ['Descri\uFFFD\uFFFDo', 'Descrição'],
      ['Relat\uFFFDrio de Pacientes', 'Relatório de Pacientes'],
      ['Activo: 4 \uFFFD Inactivo: 1', 'Activo: 4 · Inactivo: 1'],
      ['N\uFFFD Processo', 'Nº Processo'],
      ['Relat\uFFFDrio de Funcion\uFFFDrios', 'Relatório de Funcionários'],
      ['Equipa da cl\uFFFDnica por fun\uFFFD\uFFFDo.', 'Equipa da clínica por função.'],
      ['Por fun\uFFFD\uFFFDo', 'Por função'],
      ['M\uFFFDdico: 4 \uFFFD Enfermeiro: 1 \uFFFD T\uFFFDcnico: 1 \uFFFD Recep\uFFFD\uFFFDo: 1 \uFFFD Administrador: 1 \uFFFD Maqueiro: 1 \uFFFD Servente: 1', 'Médico: 4 · Enfermeiro: 1 · Técnico: 1 · Recepção: 1 · Administrador: 1 · Maqueiro: 1 · Servente: 1'],
      ['Activo: 9 \uFFFD Inactivo: 1', 'Activo: 9 · Inactivo: 1'],
      ['Fun\uFFFD\uFFFDo', 'Função']
    ]);

    if (typeof value === 'string') return replacements.get(value) || value;
    if (Array.isArray(value)) {
      value.forEach((item, index) => { value[index] = repairKnownText(item); });
    } else if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) value[key] = repairKnownText(value[key]);
    }
    return value;
  }

  function renderSavedState() {
    rin();
    rpa();
    rco();
    rpg();
    rrl();
    rfu();
    rus();
    rau();
    ic();
  }

  function applyState(state) {
    PA = state.patients;
    FU = state.employees;
    US = state.users;
    CO = state.appointments;
    PG = state.payments;
    AU = state.audit;
    RL = state.reports;
    SERVICES = state.services;
  }

  async function saveState() {
    if (!authToken || MUST_CHANGE_PASSWORD) return;
    const body = JSON.stringify(stateSnapshot());
    if (body === lastSaved) return;
    const operation = saveQueue.catch(() => {}).then(async () => {
      const currentBody = JSON.stringify(stateSnapshot());
      if (currentBody === lastSaved) return;
      const response = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
        body: currentBody
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível guardar os dados.');
      if (JSON.stringify(stateSnapshot()) === currentBody) {
        applyState(result);
        renderSavedState();
      }
      lastSaved = JSON.stringify(result);
    });
    saveQueue = operation.catch(() => {});
    await operation;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveState().catch((error) => toast(error.message || 'Não foi possível guardar os dados no servidor.'));
    }, 350);
  }

  function installAccountAccess() {
    const form = $('lf');
    const title = form.querySelector('h2');
    const email = $('li');
    const password = $('lp');
    const error = $('ler');
    const submit = form.querySelector('[type="submit"]');
    const helpText = form.querySelector('.ldm');
    const remember = form.querySelector('.lrow');
    const forgotPassword = $('lfg');
    const nameField = document.createElement('label');
    nameField.className = 'lin';
    const nameIcon = document.createElement('i');
    nameIcon.setAttribute('data-lucide', 'user-round');
    const nameInput = document.createElement('input');
    nameInput.id = 'setup-name';
    nameInput.placeholder = 'Nome do administrador';
    nameInput.setAttribute('aria-label', nameInput.placeholder);
    nameInput.autocomplete = 'name';
    nameField.append(nameIcon, nameInput);
    const confirmField = document.createElement('label');
    confirmField.className = 'lin';
    const confirmIcon = document.createElement('i');
    confirmIcon.setAttribute('data-lucide', 'lock-keyhole');
    const confirmInput = document.createElement('input');
    confirmInput.id = 'setup-password-confirm';
    confirmInput.type = 'password';
    confirmInput.placeholder = 'Confirmar palavra-passe';
    confirmInput.setAttribute('aria-label', confirmInput.placeholder);
    confirmInput.autocomplete = 'new-password';
    confirmField.append(confirmIcon, confirmInput);
    let setupMode = !systemConfigured;

    function showLogin() {
      setupMode = false;
      nameField.remove();
      confirmField.remove();
      title.textContent = 'Entrar no Sistema';
      email.type = 'email';
      email.placeholder = 'E-mail';
      email.setAttribute('aria-label', 'E-mail');
      email.autocomplete = 'username';
      password.placeholder = 'Palavra-passe';
      password.autocomplete = 'current-password';
      remember.style.display = 'flex';
      forgotPassword.style.display = '';
      submit.textContent = 'Entrar';
      helpText.textContent = 'Aceda com o e-mail e a palavra-passe da sua conta.';
      ic();
    }

    function showSetup() {
      setupMode = true;
      title.textContent = 'Configurar Sistema';
      email.type = 'email';
      email.placeholder = 'E-mail do administrador';
      email.setAttribute('aria-label', 'E-mail do administrador');
      email.autocomplete = 'email';
      password.placeholder = 'Palavra-passe (mínimo 10 caracteres)';
      password.autocomplete = 'new-password';
      remember.style.display = 'none';
      forgotPassword.style.display = 'none';
      submit.textContent = 'Criar Administrador';
      helpText.textContent = 'Primeiro acesso: crie a conta de administrador para começar.';
      form.insertBefore(nameField, email.closest('.lin'));
      form.insertBefore(confirmField, password.closest('.lin').nextSibling);
      ic();
    }

    function setFormError(message) {
      error.textContent = message;
      error.style.display = message ? '' : 'none';
    }

    form.onsubmit = async (event) => {
      event.preventDefault();
      setFormError('');

      if (setupMode) {
        const name = nameInput.value.trim();
        const address = email.value.trim();
        const secret = password.value;
        if (name.length < 2 || !address || secret.length < 10) {
          setFormError('Preencha o nome, o e-mail e uma palavra-passe com pelo menos 10 caracteres.');
          return;
        }
        if (secret !== confirmInput.value) {
          setFormError('As palavras-passe não coincidem.');
          return;
        }

        const response = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email: address, password: secret })
        });
        const result = await response.json();
        if (!response.ok) {
          setFormError(result.error || 'Não foi possível configurar o sistema.');
          return;
        }
        window.mvidaAuth.setSession(result);
        systemConfigured = true;
        try {
          await loadAuthenticatedState();
        } catch (loadError) {
          window.mvidaAuth.clearSession();
          setFormError(loadError.message || 'Não foi possível carregar os dados.');
          return;
        }
        USER = result.user;
        nameInput.value = '';
        confirmInput.value = '';
        password.value = '';
        showLogin();
        entrar(USER);
        return;
      }

      const address = email.value.trim().toLowerCase();
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, password: password.value })
      });
      const result = await response.json();
      if (!response.ok) {
        setFormError(result.error || 'E-mail ou palavra-passe incorrectos.');
        return;
      }
      window.mvidaAuth.setSession(result);
      USER = result.user;
      if (result.mustChangePassword) {
        openPasswordChange(true);
        return;
      }
      try {
        await loadAuthenticatedState();
      } catch (loadError) {
        window.mvidaAuth.clearSession();
        USER = null;
        setFormError(loadError.message || 'Não foi possível carregar os dados.');
        return;
      }
      entrar(USER);
    };

    if (setupMode) showSetup();
    else showLogin();
  }

  async function loadAuthenticatedState() {
    const response = await fetch('/api/state', { headers: { Authorization: 'Bearer ' + authToken } });
    const state = await response.json();
    if (!response.ok || !isCompatibleState(state)) {
      throw new Error(state.error || 'Não foi possível carregar os dados autorizados para esta conta.');
    }
    repairKnownText(state);
    applyState(state);
    USER = null;
    if (window.mvidaAuth.user?.pf === 'Administrador' && migrateAppointmentPayments()) {
      await saveState();
    }
    renderSavedState();
    lastSaved = JSON.stringify(stateSnapshot());
  }

  async function connect() {
    const response = await fetch('/api/setup/status');
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || 'Não foi possível verificar a configuração do sistema.');
    systemConfigured = status.configured;
    window.addEventListener('mvida:data-change', scheduleSave);
    new MutationObserver(scheduleSave).observe(document.body, { childList: true, subtree: true });
    document.body.classList.add('auth-pending');
    installAccountAccess();
    overlay.remove();
  }

  connect().catch((error) => {
    overlay.textContent = `${error.message || 'Não foi possível ligar à API.'} Reinicie o servidor e atualize a página.`;
    overlay.style.color = '#b91c1c';
  });
})();
