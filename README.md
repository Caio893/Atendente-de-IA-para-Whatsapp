# Atendente de IA para WhatsApp

Bot de atendimento para WhatsApp que coleta pedidos de visita tecnica/orcamento, organiza os dados do cliente, registra os agendamentos em SQLite e envia lembretes administrativos diarios.

O projeto foi criado como uma aplicacao pratica de Inteligencia Artificial aplicada a atendimento: a IA conversa de forma natural, mas o sistema continua responsavel por validar dados, persistir contexto, evitar vazamento de informacoes e acionar regras de negocio.

## Principais recursos

- Atendimento automatico pelo WhatsApp com `whatsapp-web.js`.
- Assistente com OpenAI para respostas ao cliente e extracao estruturada de dados.
- Fallback local baseado em regras quando a IA falha ou retorna formato invalido.
- Persistencia de visitas, sessoes e estado de automacao em SQLite.
- Transcricao local de audio com `whisper.cpp` e `ffmpeg`.
- Comandos administrativos para listar visitas, pausar, reativar, resetar, remarcar e adicionar observacoes.
- Lembretes automaticos de manha e de noite com protecao contra duplicidade.
- Dockerfile e Docker Compose para execucao em VPS.
- Healthcheck HTTP em `/health`.

## Como a IA funciona

O fluxo de cliente usa um modelo hibrido. Primeiro, o sistema extrai localmente informacoes como nome, data, horario e bairro quando possivel. Depois, envia para a OpenAI um prompt com:

- telefone do cliente;
- timezone;
- data local da mensagem;
- data minima permitida para visita;
- estado ja salvo da conversa;
- mensagem atual marcada como conteudo nao confiavel.

A IA deve retornar apenas JSON no formato:

```json
{
  "reply": "mensagem para enviar ao cliente",
  "completed": false,
  "data": {
    "clientName": "",
    "visitDate": "",
    "visitTime": "",
    "address": "",
    "neighborhood": "",
    "notes": ""
  }
}
```

O codigo valida e sanitiza a resposta antes de usar. Se a IA falhar, retornar JSON invalido ou gerar conteudo inseguro, o bot cai para o fluxo local baseado em regras.

## Arquitetura

- `index.js`: integra WhatsApp, filas de mensagens, comandos administrativos, envio de respostas, healthcheck e controle de takeover humano.
- `sessionManager.js`: gerencia o estado da conversa, combina IA com regras locais e cria solicitacoes de visita.
- `aiService.js`: monta prompts, chama a OpenAI, interpreta JSON e sanitiza a saida.
- `aiSafety.js`: bloqueia prompt injection simples, remove raciocinio interno e filtra possiveis segredos.
- `audioTranscription.js`: baixa audio do WhatsApp, converte com `ffmpeg` e transcreve com `whisper.cpp`.
- `database.js`: cria e acessa tabelas SQLite de visitas, sessoes, automacao, eventos e execucoes de notificacao.
- `cronJobs.js`: envia lembretes administrativos com idempotencia e recuperacao de execucoes perdidas.

## Stack

- Node.js 20
- whatsapp-web.js
- OpenAI API
- SQLite com better-sqlite3
- whisper.cpp
- ffmpeg
- node-cron
- Docker e Docker Compose
- Chromium em container

## Execucao com Docker

Crie o arquivo de ambiente:

```bash
cp .env.example .env
```

Configure no `.env` local ou na VPS:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
ADMIN_PHONE_NUMBER=5511999999999
PORT=3001
```

Suba o container:

```bash
docker compose up -d --build
docker compose logs -f whatsapp-bot
```

Na primeira execucao, escaneie o QR code exibido nos logs do container.

## Audio e Whisper

Para transcricao local de audio, coloque:

```text
./bin/whisper-cli
./models/ggml-tiny.bin
```

Em VPS pequena, use `AUDIO_TRANSCRIPTION_MAX_CONCURRENCY=1` para evitar multiplos processos de transcricao ao mesmo tempo.

## Comandos administrativos

```text
!semana
!ajuda
!pausar <telefone>
!reativar <telefone>
!reset <telefone>
!remarcar <texto>
!obs <telefone> <observacao>
!ignorar <telefone>
!designorar <telefone>
!ia <pergunta>
```

`!llm <pergunta>` tambem funciona como alias para o comando de IA administrativo.

## Seguranca

Este repositorio publico nao deve conter:

- `.env` real;
- sessoes do WhatsApp em `.wwebjs_auth`;
- banco SQLite real;
- logs;
- tokens;
- chaves privadas;
- modelos ou binarios pesados;
- midias privadas.

Use `.env.example` como referencia e mantenha os valores reais apenas no ambiente local ou na VPS.

## Limitacoes

Para uso profissional em escala, a API oficial WhatsApp Cloud API da Meta tende a ser a opcao mais robusta. Este projeto usa `whatsapp-web.js` por ser pratico para demonstracao, prototipo e uso com uma conta WhatsApp existente.
