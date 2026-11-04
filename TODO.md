# Estado do projecto

- [x] Preservar o dashboard e as funcionalidades do HTML de referência.
- [x] Manter a interface responsiva, incluindo navegação, calendário, tabelas, modais e documentos PDF.
- [x] Ligar pacientes, funcionários, utilizadores, consultas, pagamentos, relatórios e auditoria à API.
- [x] Persistir os dados no servidor e iniciar sem registos de demonstração.
- [x] Criar cobranças integrais ao agendar consultas; anular cobranças pendentes em cancelamentos/faltas e registar remarcações.
- [x] Gerir catálogo de serviços, pagamentos integrais e estornos com histórico preservado.
- [x] Exigir sessão na API e aplicar permissões por perfil com projecção dos dados clínicos.
- [x] Rejeitar números de processo duplicados sem renumerar dados legados automaticamente.
- [x] Recusar gravações feitas sobre uma versão desactualizada do estado numa instância.
- [x] Limitar tentativas repetidas de login por conta e origem na instância activa.
- [x] Preservar o motivo da consulta, clarificar os relatórios recebidos e suportar navegação/modal por teclado.
- [x] Incluir o gerador de PDF na compilação e permitir o dashboard sem a CDN de ícones.
- [x] Validar a API e compilar a aplicação React.

## Limitações antes do uso com dados reais

- Substituir o ficheiro JSON e a revisão local por uma base de dados com transacções/controlo de concorrência partilhado antes de activar várias réplicas.
- Configurar cópias de segurança automáticas fora do volume e testar a recuperação; o volume actual não tem backups configurados.
- Implementar encriptação dos dados em repouso e uma política de retenção e eliminação.
- Partilhar a limitação de tentativas entre réplicas e configurar monitorização e alertas de segurança.
- Fazer revisão formal das permissões, privacidade e requisitos legais antes de produção.

Não considere as alterações locais de concorrência e login como protecção entre réplicas. A aplicação só deve operar com dados reais enquanto forem atendidos os requisitos de armazenamento, cópias de segurança, segurança e conformidade aplicáveis.
