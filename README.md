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

Ao agendar uma consulta, o sistema permite horários disponíveis no horário do médico para hoje (desde que ainda não tenham passado) e para datas futuras. O preço é definido por especialidade na tela **Serviços** ou usa o preço configurado para o médico, salvo quando o preço da especialidade estiver explicitamente desactivado. O médico inicia a consulta, regista o diagnóstico e só então a conclui; nesse momento é criada uma única cobrança integral pendente, ligada à consulta. Cancelada, Falta e Concluída são estados finais. Só consultas ainda agendadas podem ser remarcadas.

O cancelamento e a falta não têm taxa; a consulta e os registos financeiros existentes são preservados. Cancelar uma consulta já paga sinaliza que o estorno precisa de ser tratado.

O pagamento é integral e registado na clínica pela Recepção ou pelo Administrador. Dinheiro não requer dado adicional; Cartão exige os últimos quatro dígitos; Transferência exige o número do comprovativo; e Pagamento móvel exige um número M-Pesa válido (84 ou 85, mais sete dígitos). Ao registar o pagamento, a API cria um número de recibo único e grava o responsável, a data e o IP da requisição. Um pagamento concluído não pode voltar a pendente. Só o Administrador pode anulá-lo; é obrigatório indicar um motivo com pelo menos três letras, e ficam preservados o histórico e o recibo. A Recepção só pode editar observações de pagamentos concluídos.

Os preços de consulta por especialidade e os serviços associados aos profissionais estão na tela **Serviços**. O Administrador pode gerir serviços e preços; a Recepção pode consultá-los e registar tratamentos. Os recibos e relatórios podem ser descarregados em PDF pelo botão de download.

## Perfis e permissões

As permissões são verificadas na API e os dados enviados a cada perfil são limitados:

- **Administrador:** gere todas as áreas e configura utilizadores, médicos, preços e serviços.
- **Recepção:** gere dados de contacto dos pacientes, agenda consultas, regista pagamentos e tratamentos; não recebe alergias, grupo sanguíneo, notas clínicas ou contas de utilizador. Não pode concluir consultas nem anular pagamentos.
- **Médico:** vê os dados clínicos dos pacientes associados às suas consultas e actualiza apenas o estado e a nota clínica das próprias consultas.
- **Financeiro:** pode consultar dados necessários para pagamentos, sem notas clínicas, mas não pode registar ou alterar pagamentos nem aceder aos relatórios.

Uma palavra-passe temporária tem de ser alterada antes do acesso aos dados. A sessão expira ao fim de oito horas.

O sistema ainda não tem contas nem um portal para pacientes; por isso, notificações directamente ao paciente e avaliações de médicos não estão disponíveis.

O número de processo de cada paciente tem de ser único. Dados legados com números repetidos continuam a ser carregados para não impedir o arranque, mas as gravações são recusadas até um administrador corrigir os duplicados. As alterações simultâneas usam uma revisão do estado; se outro utilizador guardar primeiro, a gravação antiga é recusada e a página deve ser actualizada antes de repetir as alterações.

O relatório **Pagamentos Recebidos** inclui apenas cobranças concluídas com uma data efectiva de pagamento registada, usando essa data para filtrar o período. Registos antigos sem essa data não são contabilizados nesse relatório. O motivo opcional de uma nova consulta fica guardado no registo. O PDF é carregado da compilação local; os ícones continuam a usar uma biblioteca externa opcional e podem não aparecer se a CDN estiver indisponível, sem impedir o sistema de iniciar.

## Deploy

O servidor Node.js serve o frontend compilado e a API pela mesma origem. No servidor de deploy, com Node.js 20 ou superior:

```bash
npm ci
npm run build
npm start
```

Configure `PORT` conforme a plataforma, `MVIDA_DATA_FILE` para o ficheiro de dados e `MVIDA_CREDENTIALS_FILE` para o ficheiro protegido de credenciais, ambos numa localização persistente e gravável. Sem disco persistente, os dados guardados podem desaparecer quando a plataforma reiniciar ou substituir a instância. Não inclua ficheiros `.env` nem dados clínicos no pacote de deploy.

O armazenamento JSON e o controlo de concorrência em memória destinam-se a uma única instância do servidor. Não active réplicas múltiplas sem migrar para uma base de dados com transacções/controlo de concorrência partilhado. A limitação de tentativas de login também é local à instância e deve ser complementada por protecção no ingress se forem usadas várias instâncias.

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

As credenciais e as palavras-passe temporárias são guardadas como hashes scrypt separados dos dados clínicos. A API exige sessão, aplica permissões por perfil e limita localmente a cinco tentativas de acesso falhadas por conta e origem no período de 15 minutos. Esta protecção em memória não substitui limitação no ingress e não é partilhada entre réplicas.

Continuam pendentes uma base de dados de produção, encriptação dos dados em repouso, cópias de segurança automáticas fora do volume e testes de restauro, além de uma revisão formal de privacidade. A cópia de segurança não pode ser configurada com segurança sem definir um destino externo, credenciais e retenção; o volume actual não tem backups configurados. Até essas medidas serem concluídas, use o deploy público apenas para demonstração com dados fictícios.
