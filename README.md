# WhatsApp Visit Scheduler Bot

<p align="center">
  <strong>Bot de atendimento para WhatsApp que qualifica pedidos de visita técnica, registra oportunidades em SQLite e avisa a equipe automaticamente.</strong>
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-persistent-003B57?logo=sqlite&logoColor=white">
  <img alt="OpenAI" src="https://img.shields.io/badge/OpenAI-admin_AI-111111?logo=openai&logoColor=white">
</p>

## Visão Geral

Este projeto demonstra uma automação realista para empresas que recebem solicitações de orçamento, medição ou visita técnica pelo WhatsApp. O bot conversa com o cliente, identifica intenção de agendamento, coleta nome, data preferida e bairro, persiste o atendimento e envia lembretes operacionais para a equipe.

A proposta técnica é simples de entender e forte para avaliação: transformar mensagens soltas de WhatsApp em uma fila organizada de visitas, com persistência, comandos administrativos, recuperação de falhas e uma camada opcional de IA protegida contra prompt injection.

## Destaques Para Avaliadores

- Atendimento guiado no WhatsApp com opt-in inicial, pausa automática e transferência para atendimento humano.
- Extração de dados de agendamento sem depender de IA para o fluxo crítico do cliente.
- Persistência em SQLite para visitas, sessões de conversa, contatos pausados, observações e execuções de lembretes.
- Lembretes diários com `node-cron`, controle de idempotência e recuperação de execuções perdidas após reinício.
- Comandos administrativos para listar visitas, remarcar, adicionar observações, pausar, reativar, ignorar e resetar contatos.
- Integração opcional com OpenAI para perguntas administrativas, com validação de resposta e filtros contra vazamento de instruções internas.
- Deploy Docker com health check HTTP, volume persistente e configuração por variáveis de ambiente.
- Preparação para GitHub público: sem `.env`, sem chaves, sem banco local, sem sessão do WhatsApp e sem mídia privada.

## Fluxo Do Cliente

1. O cliente envia uma mensagem para o WhatsApp da empresa.
2. O bot pergunta se o cliente deseja falar com o atendente virtual.
3. Se o cliente aceitar, o bot identifica se há intenção de visita, orçamento, medição ou vistoria.
4. O bot coleta nome, dia desejado e bairro/região.
5. A solicitação é salva no SQLite com protocolo.
6. A equipe recebe alertas e pode assumir a conversa quando necessário.

O bot também trata áudios, mensagens vazias, datas relativas como `amanhã` e `segunda-feira`, formatos brasileiros de telefone e casos em que um funcionário responde manualmente ao cliente.

## Comandos Administrativos

```text
!semana
!ajuda
!pausar <telefone>
!reativar <telefone>
!reset <telefone>
!remarcar <texto>
!obs <telefone> <observação>
!ignorar <telefone>
!designorar <telefone>
!ia <pergunta>
```

O comando `!llm <pergunta>` também funciona como alias de `!ia`. Os comandos aceitam telefones em formatos comuns do Brasil, incluindo `+55`, DDD, números sem pontuação e IDs do WhatsApp.

## Arquitetura

```text
WhatsApp Web
   |
whatsapp-web.js + Chromium
   |
Node.js application
   |-- SessionManager: fluxo conversacional e validação de datas
   |-- AppDatabase: SQLite, visitas, sessões e estados de contato
   |-- CronJobs: lembretes, idempotência e recuperação de falhas
   |-- AI Service: comandos administrativos opcionais com OpenAI
   |-- Health Server: endpoint /health para Docker/VPS
```

## IA Com Segurança

A IA não é usada para decidir o fluxo principal de agendamento do cliente. Esse fluxo é determinístico e fica no código. A OpenAI é usada apenas em comandos administrativos opcionais, como `!ia` e apoio na interpretação de remarcações.

Medidas implementadas:

- Chave lida somente de `OPENAI_API_KEY`.
- Conteúdo do usuário tratado como dado não confiável.
- Bloqueio de pedidos para revelar prompts, tokens, senhas ou instruções internas.
- Validação da resposta antes de enviá-la ao administrador.
- Fallback local quando a IA não está configurada ou falha.

## Executando Com Docker

Crie o arquivo de ambiente:

```bash
cp .env.example .env
```

Configure pelo menos:

```bash
OPENAI_API_KEY=your_real_key_here
OPENAI_MODEL=gpt-4o-mini
ADMIN_PHONE_NUMBER=5511987654321
PORT=3001
```

Suba o container:

```bash
docker compose up -d --build
docker compose logs -f whatsapp-bot
```

Escaneie o QR code exibido nos logs. O health check fica disponível em:

```bash
http://localhost:3001/health
```

## Executando Localmente

```bash
npm install
npm run check
npm start
```

## Variáveis Importantes

| Variável | Função |
| --- | --- |
| `ADMIN_PHONE_NUMBER` | Número autorizado a usar comandos administrativos. |
| `OPENAI_API_KEY` | Chave da OpenAI para comandos `!ia` e `!llm`. |
| `SQLITE_DB_PATH` | Caminho do banco SQLite. |
| `AUTH_DATA_PATH` | Pasta de autenticação persistente do WhatsApp Web. |
| `FACTORY_VIDEO_PATH` | Caminho opcional para vídeo institucional enviado no primeiro contato. |
| `CRON_TIMEZONE` | Fuso usado para datas e lembretes. |
| `MORNING_REMINDER_CRON` | Agenda do lembrete da manhã. |
| `NIGHT_REMINDER_CRON` | Agenda do lembrete da noite. |

## Segurança Da Versão Pública

Esta pasta foi preparada para publicação em GitHub público. Arquivos de risco foram excluídos da cópia: chaves privadas, possíveis tokens, `.git`, `node_modules`, banco SQLite, sessão do WhatsApp, logs e mídia privada.

Veja [SECURITY_REVIEW.md](SECURITY_REVIEW.md) para a revisão objetiva do que foi removido e por quê.

## Observação Técnica

Para produção em escala, a integração mais robusta com WhatsApp é a WhatsApp Cloud API oficial da Meta. Este projeto usa `whatsapp-web.js` porque é uma solução prática para contas já existentes e demonstra bem automação, persistência, Docker, rotinas agendadas e integração segura com IA.
