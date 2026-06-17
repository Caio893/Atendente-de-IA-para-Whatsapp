# Roteiro de Apresentacao com Referencias de Codigo

Documento base: [`docs/presentation-script-code-references.md`](./presentation-script-code-references.md)

Este roteiro foi montado para apresentar o Atendente de IA para WhatsApp / Forte Lajes para colegas de classe, com foco nos bastidores tecnicos. Cada bloco inclui uma fala sugerida e referencias diretas para arquivos, funcoes e linhas do codigo.

## Slide 1 - Abertura e Proposito (0:00-0:50)

Fala:

"Este projeto e um atendente de IA para WhatsApp. O objetivo e automatizar a primeira triagem de clientes que querem orcamento ou visita tecnica, coletando nome, telefone, data, horario, endereco ou bairro, e registrando tudo para a equipe continuar o atendimento."

Pontos tecnicos:

- A proposta do projeto aparece na descricao do pacote em [`package.json#L4`](../package.json#L4).
- A integracao com WhatsApp comeca pela importacao de `whatsapp-web.js` em [`index.js#L7`](../index.js#L7).
- Os pedidos de visita sao persistidos na tabela `visits`, criada em [`database.js#L21`](../database.js#L21).
- A criacao real de uma visita acontece em `createVisit()`, em [`database.js#L89`](../database.js#L89).

## Slide 2 - Arquitetura Geral (0:50-2:00)

Fala:

"A arquitetura e orientada a eventos. Uma mensagem chega pelo WhatsApp, o sistema identifica se e cliente ou administrador, agrupa mensagens rapidas, processa texto ou audio, consulta a IA quando necessario, salva estado no banco e responde."

Fluxo:

```text
WhatsApp
  -> index.js
  -> SessionManager
  -> OpenAI / fluxo local / Whisper
  -> SQLite
  -> resposta para cliente ou admin
```

Referencias:

- Cliente WhatsApp criado com `new Client()` em [`index.js#L128`](../index.js#L128).
- Autenticacao persistente com `LocalAuth` em [`index.js#L129`](../index.js#L129).
- Evento de mensagens recebidas em [`index.js#L188`](../index.js#L188).
- O gerenciador de sessao principal e a classe `SessionManager`, em [`sessionManager.js#L284`](../sessionManager.js#L284).
- O banco cria tabelas para visitas, sessoes, notificacoes, automacao e eventos em [`database.js#L21`](../database.js#L21), [`database.js#L37`](../database.js#L37), [`database.js#L44`](../database.js#L44), [`database.js#L55`](../database.js#L55) e [`database.js#L62`](../database.js#L62).

## Slide 3 - Jornada de Desenvolvimento (2:00-3:20)

Fala:

"O projeto evoluiu de um fluxo simples baseado em regras para um sistema hibrido. Hoje ele usa IA para conversar e extrair dados estruturados, mas mantem fallback local, transcricao de audio, lembretes e controles de seguranca."

Mudancas tecnicas:

- A IA de atendimento ao cliente pode ser ligada por `CUSTOMER_AI_ASSISTANT_ENABLED`, lida em [`index.js#L80`](../index.js#L80).
- O fluxo com IA fica em `handleCustomerAssistantMessage()`, em [`sessionManager.js#L358`](../sessionManager.js#L358).
- O fallback baseado em regras continua existindo em `handleRuleBasedTextMessage()`, em [`sessionManager.js#L342`](../sessionManager.js#L342).
- A transcricao de audio foi adicionada em `transcribeWhatsAppAudio()`, em [`audioTranscription.js#L74`](../audioTranscription.js#L74).
- Os lembretes recorrentes foram isolados em `startCronJobs()`, em [`cronJobs.js#L12`](../cronJobs.js#L12).

## Slide 4 - Stack Tecnologico e Justificativa (3:20-4:50)

Fala:

"A stack foi escolhida para rodar bem em uma VPS pequena. Node.js lida bem com eventos e I/O. whatsapp-web.js permite usar uma conta WhatsApp existente. SQLite simplifica persistencia. Docker empacota Chromium, ffmpeg e dependencias. OpenAI entra como motor de linguagem e whisper.cpp resolve audio localmente."

Referencias por tecnologia:

- Node.js 20 exigido em [`package.json#L10`](../package.json#L10) e [`package.json#L11`](../package.json#L11).
- Dependencias principais em [`package.json#L13`](../package.json#L13) ate [`package.json#L19`](../package.json#L19).
- Imagem base `node:20-bookworm-slim` em [`Dockerfile#L3`](../Dockerfile#L3) e [`Dockerfile#L20`](../Dockerfile#L20).
- Uso de Chromium instalado no container explicado em [`Dockerfile#L7`](../Dockerfile#L7).
- Healthcheck do container em [`Dockerfile#L72`](../Dockerfile#L72).
- Limites e healthcheck do Compose em [`docker-compose.yml#L28`](../docker-compose.yml#L28) ate [`docker-compose.yml#L33`](../docker-compose.yml#L33).

## Slide 5 - Entrada pelo WhatsApp e Controle de Admin (4:50-6:10)

Fala:

"O mesmo canal WhatsApp recebe mensagens de clientes e comandos administrativos. O codigo separa esses casos antes de responder, porque comando de admin nao pode ser tratado como mensagem comum de cliente."

Referencias:

- Evento `message` processa mensagens recebidas em [`index.js#L188`](../index.js#L188).
- Comandos admin autorizados chamam `handleAdminMessage()` em [`index.js#L199`](../index.js#L199) e [`index.js#L217`](../index.js#L217).
- Mensagens enviadas pelo proprio WhatsApp tambem sao avaliadas em `message_create`, em [`index.js#L253`](../index.js#L253).
- A funcao central de comandos administrativos comeca em [`index.js#L315`](../index.js#L315).
- Normalizacao de telefone para WhatsApp fica em `toWhatsAppChatId()`, em [`utils.js#L5`](../utils.js#L5).
- Validacao de numeros brasileiros fica em `normalizeBrazilianPhoneNumber()`, em [`utils.js#L18`](../utils.js#L18).

## Slide 6 - Agrupamento de Mensagens e Experiencia do Cliente (6:10-7:20)

Fala:

"Um detalhe importante e que o bot nao responde imediatamente a cada mensagem. Ele espera alguns segundos para agrupar mensagens rapidas do cliente. Isso evita respostas quebradas quando a pessoa manda nome, bairro e horario em mensagens separadas."

Referencias:

- Tempo de agrupamento configurado em `CUSTOMER_REPLY_DELAY_MS`, lido em [`index.js#L42`](../index.js#L42).
- Fila por cliente criada em `pendingCustomerMessages`, em [`index.js#L113`](../index.js#L113).
- Entrada na fila em `queueCustomerMessage()`, em [`index.js#L895`](../index.js#L895).
- Disparo posterior de `flushQueuedCustomerMessages()` em [`index.js#L940`](../index.js#L940).
- Processamento agrupado em [`index.js#L958`](../index.js#L958).
- Limites publicos de fila documentados em [`.env.example#L91`](../.env.example#L91).

## Slide 7 - Inferencia de IA no Atendimento (7:20-9:00)

Fala:

"A IA nao responde livremente sem controle. O sistema monta um prompt com contexto operacional e pede uma resposta em JSON. A IA deve devolver uma mensagem para o cliente e os campos estruturados do agendamento."

Funcoes principais:

- Entrada da inferencia em `handleCustomerAssistantTurn()`, em [`aiService.js#L98`](../aiService.js#L98).
- Prompt de sistema do assistente em [`aiService.js#L154`](../aiService.js#L154).
- Montagem do prompt com contexto em [`aiService.js#L182`](../aiService.js#L182).
- Inclusao do contexto salvo com `pickCustomerAssistantContext()` em [`aiService.js#L197`](../aiService.js#L197) e [`aiService.js#L206`](../aiService.js#L206).
- Parse defensivo do JSON em [`aiService.js#L251`](../aiService.js#L251).
- Sanitizacao dos dados retornados pela IA em [`aiService.js#L220`](../aiService.js#L220).

## Slide 8 - Chamada OpenAI e Mensagens de Sistema (9:00-10:20)

Fala:

"A chamada para a OpenAI fica isolada em um provider. Isso deixa claro onde estao modelo, endpoint, headers e formato da requisicao. O restante do sistema nao precisa saber detalhes da API."

Referencias:

- Endpoint da OpenAI em [`aiProviders/openai.js#L7`](../aiProviders/openai.js#L7).
- Modelo padrao `gpt-4o-mini` em [`aiProviders/openai.js#L8`](../aiProviders/openai.js#L8).
- Chamada HTTP com `axios.post()` em [`aiProviders/openai.js#L28`](../aiProviders/openai.js#L28).
- Mensagens montadas com `buildChatCompletionMessages()` em [`aiProviders/openai.js#L31`](../aiProviders/openai.js#L31).
- Header de autorizacao em [`aiProviders/openai.js#L35`](../aiProviders/openai.js#L35).
- Prompt de seguranca fixo em [`aiProviders/common.js#L1`](../aiProviders/common.js#L1).
- Empilhamento de mensagens `system` e `user` em [`aiProviders/common.js#L14`](../aiProviders/common.js#L14).

## Slide 9 - Seguranca Contra Prompt Injection (10:20-11:40)

Fala:

"Como mensagens de WhatsApp sao dados nao confiaveis, o projeto tenta impedir que o usuario mande instrucoes como 'ignore as regras' ou 'mostre sua chave'. A IA ajuda, mas a seguranca principal fica no codigo."

Referencias:

- Padroes bloqueados de prompt injection em [`aiSafety.js#L4`](../aiSafety.js#L4).
- Padroes sensiveis de saida em [`aiSafety.js#L24`](../aiSafety.js#L24).
- Analise de risco do prompt em [`aiSafety.js#L38`](../aiSafety.js#L38).
- Conteudo do usuario embrulhado como nao confiavel em [`aiSafety.js#L62`](../aiSafety.js#L62).
- Validacao da resposta da IA em [`aiSafety.js#L74`](../aiSafety.js#L74).
- Remocao de blocos de raciocinio interno em [`aiSafety.js#L105`](../aiSafety.js#L105).

## Slide 10 - Gerenciamento de Contexto e Persistencia (11:40-13:00)

Fala:

"O bot nao depende apenas de variaveis em memoria. Ele salva o passo da conversa e os dados parciais no SQLite. Assim, se o processo reiniciar, o atendimento pode continuar sem perder tudo."

Referencias:

- Tabela `conversation_sessions` criada em [`database.js#L37`](../database.js#L37).
- Busca de sessao persistida em [`database.js#L182`](../database.js#L182).
- Salvamento com upsert em [`database.js#L196`](../database.js#L196) e [`database.js#L198`](../database.js#L198).
- `SessionManager.getSession()` consulta cache e banco em [`sessionManager.js#L508`](../sessionManager.js#L508).
- `SessionManager.saveSession()` atualiza cache e banco em [`sessionManager.js#L708`](../sessionManager.js#L708).
- `handleIncomingMessage()` decide o fluxo a partir da sessao atual em [`sessionManager.js#L295`](../sessionManager.js#L295).

## Slide 11 - Extracao Local de Dados e Regras de Agenda (13:00-14:30)

Fala:

"Mesmo com IA, o projeto tem rotinas locais para interpretar nome, bairro, horario e data. Isso melhora a confiabilidade e permite fallback quando a IA nao estiver disponivel."

Referencias:

- Extracao geral em `extractSchedulingData()`, em [`sessionManager.js#L1056`](../sessionManager.js#L1056).
- Extracao de nome em [`sessionManager.js#L1131`](../sessionManager.js#L1131).
- Extracao de bairro em [`sessionManager.js#L1225`](../sessionManager.js#L1225).
- Extracao de horario em [`sessionManager.js#L1246`](../sessionManager.js#L1246).
- Parser de datas como "amanha", "segunda-feira" e "dia 25" em [`sessionManager.js#L1295`](../sessionManager.js#L1295).
- Validacao de antecedencia minima em [`sessionManager.js#L1363`](../sessionManager.js#L1363).
- Correcao aproximada de bairros conhecidos em [`sessionManager.js#L1480`](../sessionManager.js#L1480) e [`sessionManager.js#L1497`](../sessionManager.js#L1497).
- Distancia de Levenshtein implementada em [`sessionManager.js#L1533`](../sessionManager.js#L1533).

## Slide 12 - Transcricao de Audio com Whisper (14:30-15:50)

Fala:

"O bot tambem consegue lidar com audio. Ele baixa a midia do WhatsApp, converte para WAV com ffmpeg, roda whisper.cpp localmente e envia o texto transcrito para o mesmo fluxo de atendimento."

Fluxo tecnico:

```text
audio WhatsApp
  -> downloadMedia()
  -> ffmpeg
  -> whisper.cpp
  -> texto
  -> SessionManager
```

Referencias:

- Configuracoes de audio em [`audioTranscription.js#L26`](../audioTranscription.js#L26).
- Verificacao de binario/modelo em [`audioTranscription.js#L66`](../audioTranscription.js#L66).
- Entrada principal da transcricao em [`audioTranscription.js#L74`](../audioTranscription.js#L74).
- Escrita de arquivo temporario e conversao em [`audioTranscription.js#L113`](../audioTranscription.js#L113) e [`audioTranscription.js#L119`](../audioTranscription.js#L119).
- Execucao do Whisper em [`audioTranscription.js#L120`](../audioTranscription.js#L120) e [`audioTranscription.js#L173`](../audioTranscription.js#L173).
- Fila com limite de concorrencia em [`audioTranscription.js#L193`](../audioTranscription.js#L193).
- Limpeza do texto transcrito em [`audioTranscription.js#L275`](../audioTranscription.js#L275).

## Slide 13 - Atendimento Humano, Pausa e Anti-loop (15:50-17:00)

Fala:

"O bot foi desenhado para conviver com humanos. Quando um funcionario responde, o atendimento automatico pode ser pausado. Tambem existe protecao contra loop entre bots, para evitar conversas automaticas infinitas."

Referencias:

- Mensagens enviadas pelo proprio usuario sao observadas em [`index.js#L253`](../index.js#L253).
- Estados de automacao ficam em `contact_automation`, criado em [`database.js#L55`](../database.js#L55).
- Pausa de automacao em [`database.js#L235`](../database.js#L235).
- Reativacao em [`database.js#L246`](../database.js#L246).
- Ignorar contato em [`database.js#L257`](../database.js#L257).
- Resposta automatica enviada sem marcar como lida em [`index.js#L1565`](../index.js#L1565).
- Chat marcado como nao lido apos resposta do bot em [`index.js#L1626`](../index.js#L1626).
- Variaveis anti-loop em [`.env.example#L31`](../.env.example#L31) e [`.env.example#L32`](../.env.example#L32).

## Slide 14 - Lembretes, Idempotencia e Healthcheck (17:00-18:20)

Fala:

"A parte operacional tambem foi pensada. O sistema envia lembretes de visitas, mas evita duplicidade usando uma tabela de execucoes. Se o container reiniciar perto do horario, ha recuperacao de execucoes perdidas."

Referencias:

- Jobs iniciados em [`cronJobs.js#L12`](../cronJobs.js#L12).
- Lembretes da manha e da noite agendados em [`cronJobs.js#L17`](../cronJobs.js#L17) e [`cronJobs.js#L30`](../cronJobs.js#L30).
- Recuperacao de execucoes perdidas em [`cronJobs.js#L45`](../cronJobs.js#L45) e [`cronJobs.js#L80`](../cronJobs.js#L80).
- Execucao de lembrete em [`cronJobs.js#L129`](../cronJobs.js#L129).
- Protecao contra duplicidade com `tryStartNotificationRun()` em [`cronJobs.js#L138`](../cronJobs.js#L138) e [`database.js#L349`](../database.js#L349).
- Endpoint `/health` implementado em [`index.js#L1975`](../index.js#L1975) e validado em [`index.js#L1986`](../index.js#L1986).
- Healthcheck do Docker em [`Dockerfile#L72`](../Dockerfile#L72).

## Slide 15 - Seguranca de Segredos e Publicacao (18:20-19:20)

Fala:

"O repositorio publico deve conter codigo e exemplos, nunca segredos reais. As chaves ficam no `.env` local ou da VPS. O `.env.example` mostra o que precisa ser configurado, mas sem credenciais."

Referencias:

- Chave OpenAI deixada vazia no exemplo em [`.env.example#L11`](../.env.example#L11).
- Ativacao do assistente por variavel em [`.env.example#L18`](../.env.example#L18).
- Configuracao de audio sem segredo em [`.env.example#L37`](../.env.example#L37) e [`.env.example#L38`](../.env.example#L38).
- Caminho do SQLite configuravel em [`.env.example#L61`](../.env.example#L61).
- `.gitignore` ignora `node_modules` em [`.gitignore#L1`](../.gitignore#L1).
- O script de validacao sintatica esta em [`package.json#L8`](../package.json#L8).

## Slide 16 - Fluxo de Demonstracao ao Vivo (19:20-20:30)

Fala:

"Para demonstrar, eu posso simular uma mensagem de cliente pedindo orcamento. O sistema agrupa a mensagem, tenta extrair dados localmente, chama a IA, salva a sessao ou cria a visita, responde o cliente e envia notificacao para o admin quando a visita e concluida."

Passo a passo com linhas:

1. Mensagem chega em [`index.js#L188`](../index.js#L188).
2. Cliente entra na fila em [`index.js#L895`](../index.js#L895).
3. Fila e processada em [`index.js#L958`](../index.js#L958).
4. `SessionManager.handleIncomingMessage()` recebe o texto em [`sessionManager.js#L295`](../sessionManager.js#L295).
5. Fluxo com IA roda em [`sessionManager.js#L358`](../sessionManager.js#L358).
6. IA e chamada por [`aiService.js#L98`](../aiService.js#L98).
7. Dados finais criam a visita em [`sessionManager.js#L662`](../sessionManager.js#L662).
8. Resposta final e montada em [`sessionManager.js#L680`](../sessionManager.js#L680).
9. Resposta e enviada ao cliente em [`index.js#L1001`](../index.js#L1001).
10. Chat fica nao lido para revisao humana em [`index.js#L1017`](../index.js#L1017).

## Slide 17 - Encerramento (20:30-21:00)

Fala:

"O ponto principal e que este projeto nao e apenas um prompt ligado ao WhatsApp. Ele tem arquitetura de produto: eventos, persistencia, contexto, inferencia controlada, fallback, transcricao de audio, comandos administrativos, cron, Docker, healthcheck e seguranca de publicacao."

Resumo tecnico:

- Entrada principal: [`index.js`](../index.js).
- Gerenciamento de contexto: [`sessionManager.js`](../sessionManager.js).
- Inferencia de IA: [`aiService.js`](../aiService.js).
- Seguranca da IA: [`aiSafety.js`](../aiSafety.js).
- Persistencia: [`database.js`](../database.js).
- Transcricao: [`audioTranscription.js`](../audioTranscription.js).
- Lembretes: [`cronJobs.js`](../cronJobs.js).
- Deploy: [`Dockerfile`](../Dockerfile) e [`docker-compose.yml`](../docker-compose.yml).
