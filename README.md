# MVida Maxi Vida — Gestão Clínica

O projecto está separado em `frontend/` e `backend/`, seguindo a organização de referência. O React conserva o dashboard original e as suas funcionalidades; cada tela existente tem um registo próprio em `frontend/src/pages/` para validar a correspondência com a interface preservada.

## Estrutura

- `frontend/src/pages/` — registo das telas Início, Consultas, Pacientes, Pagamentos, Relatórios, Funcionários, Utilizadores, Auditoria e Sobre.
- `frontend/src/components/` — montagem React da interface de referência.
- `frontend/src/services/`, `routes/`, `utils/` e `styles/` — carregamento, validação e estilos da interface.
- `frontend/public/` — dashboard HTML original e ligação à API.
- `backend/src/controllers/` — endpoints HTTP.
- `backend/src/services/` — operações sobre os dados do dashboard.
- `backend/src/repositories/` — persistência do estado em ficheiro JSON.
- `backend/src/routes/`, `middlewares/`, `domain/`, `config/` e `utils/` — rotas, validação, configuração e tratamento de erros.
- `backend/data/` — estado clínico persistido localmente; ignorado pelo Git.

O dashboard de referência continua a gerir os componentes e fluxos visuais das telas, evitando alterações de interface durante esta reorganização. As telas estão registadas em ficheiros separados, e o arranque verifica que todas existem no dashboard.

## Executar

Instale as dependências na raiz do projecto:

```bash
npm ci
```

Inicie o frontend e a API em conjunto:

```bash
npm run dev
```

Abra `http://localhost:3000`. Para executar apenas a API, use `npm run server`.

Na primeira abertura, o sistema pede o nome, o e-mail e uma palavra-passe de administrador (mínimo 10 caracteres). Não existem pacientes, funcionários, consultas, pagamentos ou relatórios pré-carregados. Depois de criar a conta, registe os funcionários e os pacientes para começar a utilizar as restantes áreas. O conteúdo do dashboard fica oculto até à autenticação.

O administrador cria as contas de acesso dos funcionários e recebe uma palavra-passe temporária para entregar por um canal seguro. A conta principal criada na configuração inicial não pode ser eliminada nem desactivada. No primeiro acesso, cada utilizador tem de escolher uma palavra-passe própria. Utilizadores autenticados podem alterar a sua palavra-passe no menu do perfil; para recuperar o acesso, devem contactar um administrador, que pode emitir uma nova palavra-passe temporária. As sessões expiram após oito horas. Não é necessário e-mail nem pergunta de segurança.

O ícone de lua/sol na barra superior, ao lado das notificações, alterna entre modo claro e escuro. A preferência fica guardada neste navegador.

## Consultas, tratamentos e pagamentos

Ao agendar uma consulta, o sistema cria uma cobrança integral pendente ligada à marcação. Cada médico tem um preço base, configurável no registo ou na edição do funcionário; o valor da consulta pode ser ajustado antes de confirmar a marcação.

O cancelamento e a falta não têm taxa: uma cobrança ainda pendente é anulada, sem apagar a consulta nem a cobrança do histórico. A remarcação mantém a mesma consulta e cobrança, regista a data e hora anteriores e actualiza a data do serviço. Uma consulta já paga exige estorno integral antes de ser remarcada. Cancelar uma consulta já paga sinaliza que o estorno precisa de ser tratado; o estorno é registado com motivo.

Pagamentos são integrais, sem saldos ou parcelas. Uma cobrança pendente pode ser paga ou anulada; um pagamento concluído não pode voltar a pendente. Um estorno integral muda o registo para anulado, exige motivo e preserva o histórico e o recibo.

Tratamentos e serviços usam um catálogo de nomes e preços padrão, gerido pelo administrador na tela Pagamentos. O funcionário financeiro escolhe um serviço e pode ajustar o preço para aquela cobrança. Desactivar um serviço impede novas cobranças, mas mantém os registos anteriores. As listas de pendências, pagamentos concluídos, recibos, histórico do paciente e relatórios distinguem consulta e tratamento; a data do serviço é preservada separadamente da data do pagamento.

## Perfis e permissões

As permissões são verificadas na API e os dados enviados a cada perfil são limitados:

- **Administrador:** gere todas as áreas e configura utilizadores, médicos, preços e catálogo.
- **Recepção:** gere dados de contacto dos pacientes e agenda consultas; não recebe alergias, grupo sanguíneo, notas clínicas, pagamentos ou contas de utilizador. Não pode concluir consultas.
- **Médico:** vê os dados clínicos dos pacientes associados às suas consultas e actualiza apenas o estado e a nota clínica das próprias consultas.
- **Financeiro:** gere cobranças, pagamentos integrais, estornos e relatórios; recebe apenas os dados de paciente e consulta necessários para cobrança, sem notas clínicas.

Uma palavra-passe temporária tem de ser alterada antes do acesso aos dados. A sessão expira ao fim de oito horas.

## Deploy

O servidor Node.js serve o frontend compilado e a API pela mesma origem. No servidor de deploy, com Node.js 20 ou superior:

```bash
npm ci
npm run build
npm start
```

Configure `PORT` conforme a plataforma, `MVIDA_DATA_FILE` para o ficheiro de dados e `MVIDA_CREDENTIALS_FILE` para o ficheiro protegido de credenciais, ambos numa localização persistente e gravável. Sem disco persistente, os dados guardados podem desaparecer quando a plataforma reiniciar ou substituir a instância. Não inclua ficheiros `.env` nem dados clínicos no pacote de deploy.

## API e armazenamento

- `GET /api/health` — estado do servidor.
- `GET /api/setup/status` — indica se o sistema já foi configurado.
- `GET /api/state` — dados permitidos ao perfil da sessão autenticada.
- `POST /api/state` — migração administrativa autenticada, apenas quando ainda não existem dados.
- `PUT /api/state` — valida e guarda o estado completo.
- `POST /api/setup` — criação do primeiro administrador, permitida apenas antes de existirem utilizadores.
- `POST /api/auth/login` — validação do acesso dos utilizadores do sistema.
- `POST /api/auth/change-password` — alteração da palavra-passe da sessão autenticada.
- `POST /api/auth/logout` — encerramento da sessão autenticada.
- `POST /api/users/password/reset` — reposição administrativa de palavra-passe, com mudança obrigatória no próximo acesso.
- `POST /api/users/access` — alteração autenticada do perfil e estado da conta.

Os dados ficam em `backend/data/mvida-clinic-state.json` (ignorado pelo Git). Use `MVIDA_DATA_FILE` para indicar outro ficheiro e `API_PORT` para alterar a porta da API.

## Testes e build

```bash
npm test
npm run build
```

## Limite de segurança

As credenciais e as palavras-passe temporárias são guardadas como hashes scrypt separados dos dados clínicos. A API exige sessão e aplica permissões por perfil às operações e aos dados devolvidos. Ainda faltam uma base de dados de produção, encriptação dos dados em repouso, cópias de segurança automáticas testadas, limitação de tentativas de login e uma revisão formal de privacidade. Até essas medidas serem concluídas, use o deploy público apenas para demonstração com dados fictícios.
