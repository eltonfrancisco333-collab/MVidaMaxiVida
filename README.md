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

Cada médico tem um preço base de consulta, configurável no registo ou na edição do funcionário. Ao marcar uma consulta, o preço é preenchido com esse valor e pode ser ajustado para aquela marcação. O sistema cria automaticamente uma cobrança pendente ligada à consulta. Se a consulta for cancelada antes do pagamento, a cobrança pendente passa a anulada.

Tratamentos e outros serviços são registados separadamente na tela Pagamentos, com paciente, descrição e valor próprios. As cobranças de consultas e tratamentos aparecem em listas pendentes distintas; ao registar o pagamento, escolhe-se a forma de pagamento e é possível gerar o recibo. A data da consulta/tratamento é preservada e a data de pagamento fica registada separadamente. O histórico do paciente e os relatórios incluem valores e estados das cobranças.

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
- `GET /api/state` — dados guardados do dashboard.
- `POST /api/state` — inicialização do estado vazio, permitida apenas quando ainda não existem dados.
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

As credenciais e as palavras-passe temporárias são guardadas como hashes scrypt separados dos dados clínicos; as operações de reposição e alteração exigem uma sessão autenticada. O dashboard fica oculto antes do login, mas a API que lê e grava os dados clínicos ainda não aplica autenticação nem controlo de acesso completos. Também faltam encriptação de dados, cópias de segurança automáticas e uma base de dados de produção. Não exponha este serviço na Internet nem o utilize com dados clínicos reais sem essas protecções.
