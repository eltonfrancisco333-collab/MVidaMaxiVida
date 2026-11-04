# Estado do projecto

- [x] Preservar o dashboard e as funcionalidades do HTML de referência.
- [x] Manter a interface responsiva, incluindo navegação, calendário, tabelas, modais e documentos PDF.
- [x] Ligar pacientes, funcionários, utilizadores, consultas, pagamentos, relatórios e auditoria à API.
- [x] Persistir os dados no servidor e iniciar sem registos de demonstração.
- [x] Criar cobranças integrais ao agendar consultas; anular cobranças pendentes em cancelamentos/faltas e registar remarcações.
- [x] Gerir catálogo de serviços, pagamentos integrais e estornos com histórico preservado.
- [x] Exigir sessão na API e aplicar permissões por perfil com projecção dos dados clínicos.
- [x] Validar a API e compilar a aplicação React.

## Limitações antes do uso com dados reais

- Substituir o ficheiro JSON por uma base de dados de produção com cópias de segurança e recuperação testadas.
- Implementar encriptação dos dados em repouso e uma política de retenção e eliminação.
- Adicionar limitação de tentativas de login, monitorização e alertas de segurança.
- Fazer revisão formal das permissões, privacidade e requisitos legais antes de produção.

O deploy actual deve ser usado apenas para demonstração com dados fictícios até essas medidas serem implementadas.
