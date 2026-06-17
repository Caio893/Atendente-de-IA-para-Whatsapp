require('dotenv').config();

const fs = require('fs');
const http = require('http');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const {
  cleanupStaleChromiumProfileLocks,
  isChromiumProfileLockError
} = require('./chromiumProfile');
const { AppDatabase } = require('./database');
const {
  getAudioTranscriptionInfo,
  transcribeWhatsAppAudio
} = require('./audioTranscription');
const { startCronJobs } = require('./cronJobs');
const {
  FACTORY_VIDEO_SENT_EVENT,
  hasSchedulingIntent,
  parseVisitDay,
  SessionManager
} = require('./sessionManager');
const {
  askAi,
  getAiProviderLabel,
  getAiServiceInfo,
  interpretRescheduleCommand
} = require('./aiService');
const logger = require('./logger');
const {
  addDaysToDateKey,
  extractDigits,
  formatBrazilianPhoneNumber,
  getDateKeyInTimezone,
  normalizeBrazilianPhoneNumber,
  normalizeBrazilianPhoneDigits,
  sameWhatsAppContact,
  toWhatsAppChatId
} = require('./utils');

const customerReplyDelayMs = parseNonNegativeInteger(process.env.CUSTOMER_REPLY_DELAY_MS, 10000);
const customerFollowUpReplyDelayMs = parseNonNegativeInteger(
  process.env.CUSTOMER_FOLLOW_UP_REPLY_DELAY_MS,
  Math.max(0, customerReplyDelayMs - 5000)
);
const startedAt = new Date().toISOString();
const DEFAULT_FACTORY_VIDEO_CAPTION = [
  'Apresentamos a fábrica da Forte Lajes.',
  '',
  'Trabalhamos com treliças ArcelorMittal ou Gerdau, duas das marcas mais reconhecidas do mercado.',
  '',
  'Nossas vigas já são fabricadas e ficam disponíveis para entrega, com controle de qualidade em todas as etapas. Também utilizamos isopor de excelente qualidade, reduzindo riscos na substituição dos antigos tijolos e contribuindo para uma obra mais leve, confortável, elegante e ecologicamente correta.',
  '',
  'Nosso traço de fabricação utiliza concreto FCK 30.'
].join('\n');

const config = {
  serviceHost: process.env.HOST || '0.0.0.0',
  servicePort: parsePort(process.env.PORT, 3001),
  adminPhoneNumber: process.env.ADMIN_PHONE_NUMBER || '',
  adminChatIdCandidate: toWhatsAppChatId(process.env.ADMIN_PHONE_NUMBER || ''),
  authDataPath: process.env.AUTH_DATA_PATH || path.join(process.cwd(), '.wwebjs_auth'),
  cronTimezone: process.env.CRON_TIMEZONE || 'America/Sao_Paulo',
  sqliteDbPath: process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'database.sqlite'),
  schedules: {
    morning: process.env.MORNING_REMINDER_CRON || '0 7 * * *',
    night: process.env.NIGHT_REMINDER_CRON || '0 22 * * *',
    recovery: process.env.MISSED_RUN_CHECK_CRON || '*/5 * * * *'
  },
  enableMissedRunRecovery: process.env.ENABLE_MISSED_RUN_RECOVERY !== 'false',
  cleanupChromiumProfileLocks: process.env.CLEANUP_CHROMIUM_PROFILE_LOCKS !== 'false',
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  customerReplyDelayMs,
  customerFollowUpReplyDelayMs,
  factoryVideoPath: process.env.FACTORY_VIDEO_PATH || '',
  factoryVideoCaption: parseMultilineEnv(process.env.FACTORY_VIDEO_CAPTION, DEFAULT_FACTORY_VIDEO_CAPTION),
  markBotRepliesUnread: process.env.MARK_BOT_REPLIES_UNREAD !== 'false',
  humanTakeoverSuppressionMs: parseNonNegativeInteger(process.env.HUMAN_TAKEOVER_SUPPRESSION_MS, 5 * 60 * 1000),
  customerAiAssistantEnabled: process.env.CUSTOMER_AI_ASSISTANT_ENABLED !== 'false',
  botLoopWindowMs: parsePositiveInteger(process.env.BOT_LOOP_WINDOW_MS, 10 * 60 * 1000),
  botLoopMaxAutoReplies: parsePositiveInteger(process.env.BOT_LOOP_MAX_AUTO_REPLIES, 6),
  maxFactoryVideoBytes: parseNonNegativeInteger(process.env.MAX_FACTORY_VIDEO_BYTES, 20 * 1024 * 1024),
  maxPendingCustomers: parsePositiveInteger(process.env.MAX_PENDING_CUSTOMERS, 100),
  maxQueuedMessagesPerCustomer: parsePositiveInteger(process.env.MAX_QUEUED_MESSAGES_PER_CUSTOMER, 10),
  maxQueuedMessageChars: parsePositiveInteger(process.env.MAX_QUEUED_MESSAGE_CHARS, 4000),
  whatsappOperationTimeoutMs: parsePositiveInteger(process.env.WHATSAPP_OPERATION_TIMEOUT_MS, 45000),
  whatsappWatchdogIntervalMs: parsePositiveInteger(process.env.WHATSAPP_WATCHDOG_INTERVAL_MS, 60000),
  whatsappWatchdogTimeoutMs: parsePositiveInteger(process.env.WHATSAPP_WATCHDOG_TIMEOUT_MS, 15000),
  whatsappWatchdogMaxFailures: parsePositiveInteger(process.env.WHATSAPP_WATCHDOG_MAX_FAILURES, 3),
  sessionCacheMaxEntries: parsePositiveInteger(process.env.MAX_SESSION_CACHE_ENTRIES, 1000),
  sessionCacheTtlMs: parsePositiveInteger(process.env.SESSION_CACHE_TTL_MS, 24 * 60 * 60 * 1000)
};

const database = new AppDatabase(config.sqliteDbPath);
database.init();

const sessionManager = new SessionManager(database, {
  timezone: config.cronTimezone,
  customerAssistantEnabled: config.customerAiAssistantEnabled,
  maxCacheEntries: config.sessionCacheMaxEntries,
  cacheTtlMs: config.sessionCacheTtlMs
});

let cronController = null;
let healthServer = null;
let adminChatId = config.adminChatIdCandidate;
let whatsappReady = false;
let whatsappWatchdogTimer = null;
let whatsappWatchdogFailures = 0;
const botOutgoingMessages = [];
const processedAdminCommandMessageIds = new Set();
const pendingCustomerMessages = new Map();
const humanTakeoverSuppressions = new Map();
const automaticReplyHistory = new Map();
const AUDIO_TRANSCRIPTION_FAILURE_REPLY = 'Tive um problema ao transcrever seu audio. Pode tentar enviar novamente em instantes?';

class AudioTranscriptionRequiredError extends Error {
  constructor(reason, skipped) {
    super(`Audio transcription failed: ${reason || 'unknown'}`);
    this.name = 'AudioTranscriptionRequiredError';
    this.code = 'AUDIO_TRANSCRIPTION_REQUIRED';
    this.reason = reason || 'unknown';
    this.skipped = Boolean(skipped);
  }
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: config.authDataPath
  }),
  puppeteer: {
    executablePath: config.puppeteerExecutablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ]
  }
});

client.on('qr', (qr) => {
  logger.info('WhatsApp QR code generated. Scan it with the WhatsApp mobile app.');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  logger.info('WhatsApp authenticated');
});

client.on('auth_failure', (message) => {
  logger.error('WhatsApp authentication failed', { reason: message });
});

client.on('ready', async () => {
  logger.info('WhatsApp client is ready');
  whatsappReady = true;
  whatsappWatchdogFailures = 0;
  startWhatsAppWatchdog();

  if (!cronController) {
    adminChatId = await resolveAdminChatId();

    cronController = startCronJobs({
      client,
      database,
      adminChatId,
      getAdminChatId: () => adminChatId,
      sendAdminMessage,
      timezone: config.cronTimezone,
      schedules: config.schedules,
      enableRecovery: config.enableMissedRunRecovery
    });
  }
});

client.on('disconnected', (reason) => {
  whatsappReady = false;
  logger.warn('WhatsApp disconnected; exiting so Docker can restart cleanly', { reason });
  setTimeout(() => process.exit(1), 5000);
});

client.on('message', async (message) => {
  try {
    const body = String(message.body || '').trim();
    const commandName = getAdminCommandName(body);

    if (commandName) {
      const adminDecision = getAdminCommandDecision(message, body, 'message');
      logAdminCommandDecision(adminDecision);

      if (adminDecision.authorized) {
        if (markAdminCommandProcessed(message)) {
          await handleAdminMessage(message, body);
        }
        return;
      }

      if (!adminDecision.authorized && !message.fromMe && !isGroupMessage(message.from)) {
        const customerPhone = await resolveCustomerPhone(message);
        if (isIgnoredContact(customerPhone)) return;

        await safeReply(message, 'Esse comando é exclusivo da equipe da Forte Lajes.');
        return;
      }
    }

    if (message.fromMe || isGroupMessage(message.from) || isSystemBroadcastMessage(message)) return;

    if (isAdmin(message.from)) {
      if (!body) return;
      await handleAdminMessage(message, body);
      return;
    }

    const customerPhone = await resolveCustomerPhone(message);
    if (!customerPhone) {
      logger.warn('Could not resolve customer phone number from WhatsApp contact', {
        from: message.from
      });
    }

    if (isIgnoredContact(customerPhone)) {
      logger.info('Incoming message ignored for admin-ignored contact', {
        from: message.from,
        customerPhone
      });
      return;
    }

    queueCustomerMessage({
      message,
      customerPhone,
      body,
      receivedAt: getMessageDate(message),
      mediaType: isAudioMessage(message) ? 'audio' : 'text'
    });
  } catch (error) {
    logger.error('Failed to process incoming message', {
      from: message.from,
      error
    });

    await safeReply(message, 'Tive um problema ao processar sua mensagem. Pode tentar novamente em instantes?');
  }
});

client.on('message_create', async (message) => {
  try {
    if (!message.fromMe) return;

    const body = String(message.body || '').trim();
    const commandName = getAdminCommandName(body);

    if (commandName) {
      const adminDecision = getAdminCommandDecision(message, body, 'message_create');
      logAdminCommandDecision(adminDecision);

      if (adminDecision.authorized) {
        if (markAdminCommandProcessed(message)) {
          await handleAdminMessage(message, body);
        }
        return;
      }

      logger.warn('Outgoing admin command ignored', {
        commandName,
        reason: adminDecision.reason,
        candidates: adminDecision.candidates
      });
      return;
    }

    const targetChatId = message.to || message.from;
    if (!targetChatId || isGroupMessage(targetChatId) || isAdmin(targetChatId)) return;

    if (wasSentByBot(targetChatId, body)) return;

    const clientPhone = await resolvePhoneForChatId(targetChatId);
    if (!clientPhone) return;
    if (isIgnoredContact(clientPhone)) return;

    const suppressedHumanTakeover = consumeHumanTakeoverSuppression([
      clientPhone,
      targetChatId
    ]);
    if (suppressedHumanTakeover) {
      logger.info('Human takeover pause skipped after admin reactivation', {
        clientPhone,
        chatId: targetChatId,
        suppressionReason: suppressedHumanTakeover.reason
      });
      return;
    }

    database.pauseAutomation(clientPhone, 'human_takeover');
    sessionManager.clearSession(clientPhone);
    clearPendingCustomerReply(clientPhone);
    clearAutomaticReplyHistory(clientPhone);

    logger.info('Automation paused for customer after human employee reply', {
      clientPhone,
      chatId: targetChatId
    });
  } catch (error) {
    logger.error('Failed to process outgoing message for human takeover', { error });
  }
});

async function handleAdminMessage(message, body) {
  const learnedAdminChatId = getAdminChatIdCandidateFromMessage(message);
  if (learnedAdminChatId && learnedAdminChatId !== adminChatId) {
    adminChatId = learnedAdminChatId;
    logger.info('Admin chat id learned from incoming admin message', { adminChatId });
  }

  const lower = body.toLowerCase();

  if (lower === '!semana') {
    const today = getDateKeyInTimezone(new Date(), config.cronTimezone);
    const endDate = addDaysToDateKey(today, 6);
    const visits = database.listVisitsBetween(today, endDate);
    logger.info('Weekly visits admin command executed', {
      startDate: today,
      endDate,
      timezone: config.cronTimezone,
      visitCount: visits.length
    });
    await message.reply(formatWeeklyVisits(visits, today, endDate));
    return;
  }

  if (lower === '!ajuda' || lower === '!help') {
    await message.reply([
      'Comandos administrativos:',
      '!semana - visitas dos próximos 7 dias',
      '!reativar <telefone> - reativa o atendimento automático de um cliente',
      '!reset <telefone> - limpa estado, preferências e reativa o cliente',
      '!pausar <telefone> - pausa o atendimento automático de um cliente',
      '!remarcar <texto> - remarca a visita de um cliente',
      '!obs <telefone> <observação> - adiciona observação ao cadastro/visita do cliente',
      '!ignorar <telefone> - ignora totalmente um contato no bot',
      '!designorar <telefone> - remove o status de ignorado',
      `!ia <pergunta> - consulta experimental a OpenAI (${getAiProviderLabel()})`
    ].join('\n'));
    return;
  }

  if (lower === '!reset' || lower.startsWith('!reset ')) {
    const resetTarget = getCommandArgument(body);
    const phoneResult = parseAdminPhoneInput(resetTarget, '!reset');
    if (!phoneResult.ok) {
      await message.reply(formatInvalidAdminPhoneMessage('!reset'));
      return;
    }

    const normalizedClientPhone = phoneResult.normalized;
    const resetKeys = buildContactStateKeys(resetTarget);
    const currentDateKey = getDateKeyInTimezone(getMessageDate(message), config.cronTimezone);
    const matchingVisit = database.findVisitByPhone(resetKeys, currentDateKey);
    const resetResult = database.resetContactState(resetKeys);
    sessionManager.clearSessions(resetKeys);
    const clearedPendingReplies = clearPendingCustomerReply(resetKeys);
    const clearedOutgoingMemory = clearBotOutgoingMemory(resetKeys);
    const clearedAutomaticReplyHistory = clearAutomaticReplyHistory(resetKeys);
    const suppressedHumanTakeoverKeys = suppressNextHumanTakeover(resetKeys, 'admin_reset');
    const remainingState = summarizeRemainingContactState(resetResult.remainingState);
    const matchingContactFound = Boolean(matchingVisit) || didResetDeleteAnyState(resetResult);
    logAdminPhoneMatch('!reset', phoneResult.original, normalizedClientPhone, matchingContactFound);

    logger.info('Contact reset completed', {
      originalPhone: resetTarget,
      normalizedPhone: normalizedClientPhone,
      matchingContactFound,
      resetKeys,
      deletedSessions: resetResult.deletedSessions,
      deletedAutomationRows: resetResult.deletedAutomationRows,
      deletedContactEvents: resetResult.deletedContactEvents,
      clearedPendingReplies,
      clearedOutgoingMemory,
      clearedAutomaticReplyHistory,
      suppressedHumanTakeoverKeys,
      remainingState
    });

    const resetReply = [
      `Reset concluído para ${normalizedClientPhone}.`,
      'Esse contato começará um novo fluxo na próxima mensagem.',
      `Estados removidos: conversas ${resetResult.deletedSessions}, automação ${resetResult.deletedAutomationRows}, eventos ${resetResult.deletedContactEvents}.`
    ];

    if (Object.keys(remainingState).length > 0) {
      resetReply.push('Atenção: ainda existe estado salvo para esse contato. Confira os logs do bot.');
    } else {
      resetReply.push('Nenhum estado restante foi encontrado para esse contato.');
    }

    await message.reply(resetReply.join('\n'));
    return;
  }

  if (lower === '!reativar' || lower.startsWith('!reativar ')) {
    const phoneResult = parseAdminPhoneInput(getCommandArgument(body), '!reativar');
    if (!phoneResult.ok) {
      await message.reply(formatInvalidAdminPhoneMessage('!reativar'));
      return;
    }

    const clientPhone = phoneResult.normalized;
    const resetKeys = buildContactStateKeys(clientPhone);
    const currentDateKey = getDateKeyInTimezone(getMessageDate(message), config.cronTimezone);
    const visit = database.findVisitByPhone(resetKeys, currentDateKey);
    logAdminPhoneMatch('!reativar', phoneResult.original, clientPhone, Boolean(visit));
    const clearedAutomationRows = clearAutomationState(resetKeys);
    database.reactivateAutomation(clientPhone, 'admin_reactivated');
    sessionManager.clearSessions(resetKeys);
    clearPendingCustomerReply(resetKeys);
    clearAutomaticReplyHistory(resetKeys);
    const suppressedHumanTakeoverKeys = suppressNextHumanTakeover(resetKeys, 'admin_reactivated');
    logger.info('Contact reactivated by admin command', {
      clientPhone,
      clearedAutomationRows,
      suppressedHumanTakeoverKeys
    });
    await message.reply(`Atendimento automático reativado para ${clientPhone}.`);
    return;
  }

  if (lower === '!pausar' || lower.startsWith('!pausar ')) {
    const phoneResult = parseAdminPhoneInput(getCommandArgument(body), '!pausar');
    if (!phoneResult.ok) {
      await message.reply(formatInvalidAdminPhoneMessage('!pausar'));
      return;
    }

    const clientPhone = phoneResult.normalized;
    const resetKeys = buildContactStateKeys(clientPhone);
    const currentDateKey = getDateKeyInTimezone(getMessageDate(message), config.cronTimezone);
    const visit = database.findVisitByPhone(resetKeys, currentDateKey);
    logAdminPhoneMatch('!pausar', phoneResult.original, clientPhone, Boolean(visit));
    database.pauseAutomation(clientPhone, 'admin_paused');
    sessionManager.clearSessions(resetKeys);
    clearPendingCustomerReply(resetKeys);
    clearAutomaticReplyHistory(resetKeys);
    await message.reply(`Atendimento automático pausado para ${clientPhone}.`);
    return;
  }

  if (lower === '!remarcar' || lower.startsWith('!remarcar ')) {
    await handleRescheduleCommand(message, body);
    return;
  }

  if (lower === '!obs' || lower.startsWith('!obs ')) {
    await handleObservationCommand(message, body);
    return;
  }

  if (lower === '!ignorar' || lower.startsWith('!ignorar ')) {
    await handleIgnoreCommand(message, body);
    return;
  }

  if (lower === '!designorar' || lower.startsWith('!designorar ')) {
    await handleUnignoreCommand(message, body);
    return;
  }

  if (lower === '!ia' || lower.startsWith('!ia ') || lower === '!llm' || lower.startsWith('!llm ')) {
    const response = await handleLLMQuery(body);
    await message.reply(response);
    return;
  }

  if (body.startsWith('!')) {
    await message.reply('Comando não reconhecido. Envie !ajuda para ver as opções.');
  }
}

async function handleLLMQuery(messageBody) {
  const prompt = String(messageBody || '').replace(/^!(ia|llm)\s*/i, '').trim();

  if (!prompt) {
    return 'Envie sua pergunta depois do comando. Exemplo: !ia quais visitas tenho amanhã?';
  }

  return await askAi(prompt);
}

async function handleRescheduleCommand(message, body) {
  const argument = getCommandArgument(body);
  if (!argument) {
    await message.reply('Informe o pedido de remarcação. Exemplo: !remarcar Gostaria de remarcar a visita de 21976336182 para dia 25');
    return;
  }

  const localInterpretation = interpretRescheduleCommandLocally(argument, '!remarcar');
  const aiInterpretation = await interpretRescheduleCommand(argument);
  const localPhoneResult = localInterpretation.phoneResult;
  const aiPhoneResult = parseAdminPhoneInput(aiInterpretation.phone, '!remarcar', { logOnlyWhenPresent: true });
  const phoneResult = localPhoneResult.ok ? localPhoneResult : aiPhoneResult;

  if (!phoneResult.ok) {
    await message.reply(formatInvalidAdminPhoneMessage('!remarcar'));
    return;
  }

  const clientPhone = phoneResult.normalized;
  const receivedAt = getMessageDate(message);
  const parsedDate = parseAdminVisitDate([
    localInterpretation.dateText,
    aiInterpretation.dateText,
    argument
  ], receivedAt);

  if (!parsedDate.ok) {
    await message.reply(parsedDate.reason || 'Não consegui identificar a nova data da visita.');
    return;
  }

  const currentDateKey = getDateKeyInTimezone(receivedAt, config.cronTimezone);
  const visit = database.findVisitByPhone(buildContactStateKeys(clientPhone), currentDateKey);
  logAdminPhoneMatch('!remarcar', phoneResult.original, clientPhone, Boolean(visit));
  if (!visit) {
    await message.reply(`Não encontrei visita agendada para ${formatBrazilianPhoneNumber(clientPhone)}.`);
    return;
  }

  const oldVisitDate = visit.visit_date;
  const updatedVisit = database.updateVisitDate(visit.id, parsedDate.visitDate);

  logger.info('Visit rescheduled by admin command', {
    visitId: visit.id,
    clientPhone,
    oldVisitDate,
    newVisitDate: parsedDate.visitDate
  });

  await message.reply([
    'Visita remarcada com sucesso.',
    '',
    `Cliente: ${updatedVisit.client_name || 'Não informado'}`,
    `WhatsApp: ${formatBrazilianPhoneNumber(updatedVisit.client_phone)}`,
    `Data anterior: ${formatDateBr(oldVisitDate)}`,
    `Nova data: ${formatDateBr(updatedVisit.visit_date)}`,
    `Protocolo: #${updatedVisit.id}`
  ].join('\n'));
}

async function handleObservationCommand(message, body) {
  const argument = getCommandArgument(body);
  const parsed = extractPhoneAndRemainderFromText(argument, '!obs');

  if (!parsed.phoneResult.ok) {
    await message.reply(formatInvalidAdminPhoneMessage('!obs'));
    return;
  }

  const clientPhone = parsed.phoneResult.normalized;
  const note = parsed.remainder.replace(/^[:,-]\s*/, '').trim();
  if (!note) {
    await message.reply('Informe a observação depois do telefone. Exemplo: !obs 21976336182 Cliente informou laje de 80m².');
    return;
  }

  const currentDateKey = getDateKeyInTimezone(getMessageDate(message), config.cronTimezone);
  const visit = database.findVisitByPhone(buildContactStateKeys(clientPhone), currentDateKey);
  logAdminPhoneMatch('!obs', parsed.phoneResult.original, clientPhone, Boolean(visit));
  if (!visit) {
    await message.reply(`Não encontrei cadastro/visita para ${formatBrazilianPhoneNumber(clientPhone)}.`);
    return;
  }

  const noteEntry = `[${formatDateTimeBr(new Date(), config.cronTimezone)}] ${note}`;
  const updatedVisit = database.appendVisitNote(visit.id, noteEntry);

  logger.info('Customer note added by admin command', {
    visitId: visit.id,
    clientPhone
  });

  await message.reply([
    'Observação salva com sucesso.',
    '',
    `Cliente: ${updatedVisit.client_name || 'Não informado'}`,
    `WhatsApp: ${formatBrazilianPhoneNumber(updatedVisit.client_phone)}`,
    `Protocolo: #${updatedVisit.id}`
  ].join('\n'));
}

async function handleIgnoreCommand(message, body) {
  const phoneResult = parseAdminPhoneInput(getCommandArgument(body), '!ignorar');
  if (!phoneResult.ok) {
    await message.reply(formatInvalidAdminPhoneMessage('!ignorar'));
    return;
  }

  const clientPhone = phoneResult.normalized;
  const resetKeys = buildContactStateKeys(clientPhone);
  const currentDateKey = getDateKeyInTimezone(getMessageDate(message), config.cronTimezone);
  const visit = database.findVisitByPhone(resetKeys, currentDateKey);
  logAdminPhoneMatch('!ignorar', phoneResult.original, clientPhone, Boolean(visit));
  database.ignoreContact(clientPhone, 'admin_ignored');
  for (const key of resetKeys) {
    database.deleteSession(key);
  }
  sessionManager.clearSessions(resetKeys);
  const clearedPendingReplies = clearPendingCustomerReply(resetKeys);
  clearBotOutgoingMemory(resetKeys);
  clearAutomaticReplyHistory(resetKeys);

  logger.info('Contact ignored by admin command', {
    clientPhone,
    clearedPendingReplies
  });

  await message.reply(`Contato ${formatBrazilianPhoneNumber(clientPhone)} será ignorado pelo bot. As próximas mensagens ficarão somente para atendimento humano.`);
}

async function handleUnignoreCommand(message, body) {
  const phoneResult = parseAdminPhoneInput(getCommandArgument(body), '!designorar');
  if (!phoneResult.ok) {
    await message.reply(formatInvalidAdminPhoneMessage('!designorar'));
    return;
  }

  const clientPhone = phoneResult.normalized;
  const resetKeys = buildContactStateKeys(clientPhone);
  const currentDateKey = getDateKeyInTimezone(getMessageDate(message), config.cronTimezone);
  const visit = database.findVisitByPhone(resetKeys, currentDateKey);
  logAdminPhoneMatch('!designorar', phoneResult.original, clientPhone, Boolean(visit));
  const clearedAutomationRows = clearAutomationState(resetKeys);
  database.reactivateAutomation(clientPhone, 'admin_unignored');
  sessionManager.clearSessions(resetKeys);
  clearPendingCustomerReply(resetKeys);
  clearBotOutgoingMemory(resetKeys);
  clearAutomaticReplyHistory(resetKeys);
  const suppressedHumanTakeoverKeys = suppressNextHumanTakeover(resetKeys, 'admin_unignored');

  logger.info('Contact unignored by admin command', {
    clientPhone,
    clearedAutomationRows,
    suppressedHumanTakeoverKeys
  });

  await message.reply(`Contato ${formatBrazilianPhoneNumber(clientPhone)} deixou de ser ignorado pelo bot.`);
}

function getAdminCommandName(body) {
  const match = String(body || '').trim().match(/^!(\S+)/);
  return match ? `!${match[1].toLowerCase()}` : '';
}

function getCommandArgument(body) {
  return String(body || '').trim().replace(/^!\S+\s*/i, '').trim();
}

function parseAdminPhoneInput(value, commandName, options = {}) {
  const result = normalizeBrazilianPhoneNumber(value);
  if (!options.logOnlyWhenPresent || result.original) {
    logger.info('Admin phone normalized', {
      commandName,
      originalPhoneInput: result.original,
      digits: result.digits,
      normalizedPhone: result.normalized,
      valid: result.ok,
      reason: result.reason
    });
  }
  return result;
}

function formatInvalidAdminPhoneMessage(commandName) {
  const usageByCommand = {
    '!remarcar': '!remarcar visita de <telefone> para <data>',
    '!obs': '!obs <telefone> <observação>'
  };
  const usage = usageByCommand[commandName] || `${commandName} <telefone>`;

  return [
    'Telefone inválido ou incompleto.',
    '',
    `Use: ${usage}`,
    'Exemplos aceitos: 21965399168, +55 21 96539-9168, 55 21 96539-9168 ou 5521965399168.'
  ].join('\n');
}

function logAdminPhoneMatch(commandName, originalPhoneInput, normalizedPhone, matchingContactFound) {
  logger.info('Admin phone contact lookup completed', {
    commandName,
    originalPhoneInput,
    normalizedPhone,
    matchingContactFound
  });
}

function didResetDeleteAnyState(resetResult) {
  return Boolean(
    resetResult
    && (resetResult.deletedSessions || resetResult.deletedAutomationRows || resetResult.deletedContactEvents)
  );
}

function interpretRescheduleCommandLocally(text, commandName) {
  const parsedPhone = extractPhoneAndRemainderFromText(text, commandName);
  return {
    phone: parsedPhone.phoneResult.normalized,
    phoneResult: parsedPhone.phoneResult,
    dateText: parsedPhone.remainder || text
  };
}

function parseAdminVisitDate(dateTextCandidates, receivedAt) {
  const candidates = [...new Set((Array.isArray(dateTextCandidates) ? dateTextCandidates : [dateTextCandidates])
    .map((candidate) => String(candidate || '').trim())
    .filter(Boolean))];

  let firstMatchedError = null;
  for (const candidate of candidates) {
    const parsed = parseVisitDay(candidate, {
      receivedAt,
      timezone: config.cronTimezone,
      allowLooseDay: true
    });

    if (parsed.ok) return parsed;
    if (parsed.matched && !firstMatchedError) firstMatchedError = parsed;
  }

  return firstMatchedError || {
    ok: false,
    matched: false,
    reason: 'Não consegui identificar a nova data da visita.'
  };
}

function extractPhoneAndRemainderFromText(text, commandName = 'admin_text_phone') {
  const source = String(text || '').trim();
  const matches = source.matchAll(/(?:\+?55[\s().-]*)?0?\(?\d{2}\)?[\s().-]*9?\d{4}[\s().-]*\d{4}(?:@c\.us)?/gi);

  for (const match of matches) {
    const raw = match[0];
    const phoneResult = parseAdminPhoneInput(raw, commandName);
    const digitCount = extractDigits(raw).length;
    if (!phoneResult.ok || digitCount < 10 || digitCount > 13) continue;

    const start = match.index || 0;
    const end = start + raw.length;
    return {
      phone: phoneResult.normalized,
      phoneResult,
      raw,
      remainder: `${source.slice(0, start)} ${source.slice(end)}`.replace(/\s+/g, ' ').trim()
    };
  }

  return {
    phone: '',
    phoneResult: normalizeBrazilianPhoneNumber(''),
    raw: '',
    remainder: source
  };
}

function buildContactStateKeys(value) {
  const raw = String(value || '').trim();
  const digits = extractDigits(raw);
  const normalized = normalizeBrazilianPhoneDigits(raw);
  const national = normalized.startsWith('55') && (normalized.length === 12 || normalized.length === 13)
    ? normalized.slice(2)
    : '';
  const keys = [
    raw,
    digits,
    normalized,
    national,
    normalized ? `${normalized}@c.us` : '',
    national ? `${national}@c.us` : '',
    raw.includes('@') ? raw : '',
    raw.includes('@') ? extractDigits(raw) : ''
  ];

  return [...new Set(keys.filter(Boolean))];
}

function summarizeRemainingContactState(remainingState = {}) {
  return Object.fromEntries(Object.entries(remainingState)
    .filter(([, counts]) => counts.sessions || counts.automation || counts.contactEvents));
}

function clearAutomationState(keys) {
  let deletedAutomationRows = 0;

  for (const key of keys) {
    deletedAutomationRows += database.deleteAutomationState(key);
  }

  return deletedAutomationRows;
}

function getAdminChatIdCandidateFromMessage(message) {
  const candidate = getAdminContactCandidates(message).find((contact) => isAdmin(contact));
  if (!candidate) return '';
  return String(candidate).includes('@') ? String(candidate) : toWhatsAppChatId(candidate);
}

function getAdminCommandDecision(message, body, eventName) {
  const commandName = getAdminCommandName(body);
  const candidates = getAdminContactCandidates(message);
  const authorizedCandidate = candidates.find((candidate) => isAdmin(candidate));

  return {
    eventName,
    commandName,
    fromMe: Boolean(message.fromMe),
    sender: message.from || '',
    target: message.to || '',
    normalizedSender: normalizeBrazilianPhoneDigits(message.from || ''),
    normalizedTarget: normalizeBrazilianPhoneDigits(message.to || ''),
    configuredAdmin: config.adminPhoneNumber,
    normalizedConfiguredAdmin: normalizeBrazilianPhoneDigits(config.adminPhoneNumber),
    adminChatId,
    candidates: candidates.map((candidate) => ({
      raw: candidate,
      normalized: normalizeBrazilianPhoneDigits(candidate),
      isAdmin: isAdmin(candidate)
    })),
    authorized: Boolean(authorizedCandidate),
    reason: authorizedCandidate ? 'authorized_admin_contact' : 'no_admin_contact_match'
  };
}

function getAdminContactCandidates(message) {
  const candidates = [
    message.from,
    message.to,
    message.author,
    message.id && message.id.remote,
    message.id && message.id.participant,
    message._data && message._data.from,
    message._data && message._data.to,
    message._data && message._data.author,
    message._data && message._data.id && message._data.id.remote,
    message._data && message._data.id && message._data.id.participant
  ];

  return [...new Set(candidates.filter(Boolean).map((candidate) => String(candidate)))];
}

function logAdminCommandDecision(decision) {
  const payload = {
    event: decision.eventName,
    commandName: decision.commandName,
    fromMe: decision.fromMe,
    sender: decision.sender,
    target: decision.target,
    normalizedSender: decision.normalizedSender,
    normalizedTarget: decision.normalizedTarget,
    normalizedConfiguredAdmin: decision.normalizedConfiguredAdmin,
    adminChatId: decision.adminChatId,
    isAdmin: decision.authorized,
    reason: decision.reason,
    candidates: decision.candidates
  };

  if (decision.authorized) {
    logger.info('Admin command detected', payload);
  } else {
    logger.warn('Admin command ignored', payload);
  }
}

function markAdminCommandProcessed(message) {
  const messageId = message && message.id && message.id._serialized;
  if (!messageId) return true;

  if (processedAdminCommandMessageIds.has(messageId)) {
    logger.debug('Duplicate admin command event ignored', { messageId });
    return false;
  }

  processedAdminCommandMessageIds.add(messageId);
  setTimeout(() => {
    processedAdminCommandMessageIds.delete(messageId);
  }, 60000).unref();

  return true;
}

function queueCustomerMessage({ message, customerPhone, body, receivedAt, mediaType }) {
  const key = getCustomerQueueKey({ from: message.from, customerPhone });
  const existing = pendingCustomerMessages.get(key);

  if (!existing && pendingCustomerMessages.size >= config.maxPendingCustomers) {
    logger.warn('Customer message queue is full; dropping incoming message', {
      key,
      maxPendingCustomers: config.maxPendingCustomers
    });
    safeReply(message, 'Estamos com alta demanda no atendimento automatico. Pode tentar novamente em instantes?');
    return;
  }

  const delayMs = existing ? existing.delayMs : getCustomerReplyDelayMs({
    from: message.from,
    customerPhone
  });

  if (existing && existing.timer) {
    clearTimeout(existing.timer);
  }

  const entry = existing || {
    from: message.from,
    customerPhone,
    messages: [],
    lastMessage: null
  };

  entry.from = message.from;
  entry.customerPhone = customerPhone || entry.customerPhone;
  entry.delayMs = delayMs;
  entry.lastMessage = message;
  entry.messages.push({
    body: truncateForQueue(body),
    receivedAt,
    mediaType,
    sourceMessage: mediaType === 'audio' ? message : null
  });

  if (entry.messages.length > config.maxQueuedMessagesPerCustomer) {
    entry.messages.splice(0, entry.messages.length - config.maxQueuedMessagesPerCustomer);
  }

  entry.timer = setTimeout(() => {
    flushQueuedCustomerMessages(key).catch((error) => {
      logger.error('Failed to flush queued customer messages', {
        key,
        error
      });
    });
  }, entry.delayMs);

  pendingCustomerMessages.set(key, entry);

  logger.debug('Customer message queued', {
    key,
    messageCount: entry.messages.length,
    pendingCustomers: pendingCustomerMessages.size,
    delayMs: entry.delayMs
  });
}

async function flushQueuedCustomerMessages(key) {
  const entry = pendingCustomerMessages.get(key);
  if (!entry) return;

  pendingCustomerMessages.delete(key);

  const lastItem = entry.messages[entry.messages.length - 1];
  const replyTarget = entry.lastMessage;
  const preparedMessages = await prepareQueuedCustomerMessages(entry);
  const combinedBody = preparedMessages
    .map((item) => String(item.body || '').trim())
    .filter(Boolean)
    .join('\n');
  const hasAudio = preparedMessages.some((item) => item.mediaType === 'audio');
  const hasTranscribedAudio = preparedMessages.some((item) => item.transcribedAudio);
  const mediaType = combinedBody ? 'text' : (hasAudio ? 'audio' : 'text');

  try {
    let result = await sessionManager.handleIncomingMessage({
      from: entry.from,
      customerPhone: entry.customerPhone,
      body: combinedBody,
      receivedAt: lastItem.receivedAt,
      mediaType,
      transcribedAudio: hasTranscribedAudio
    });

    if (result.suppressed) return;

    if (hasTranscribedAudio) {
      result = withTranscribedAudioReplyFallback(result, combinedBody);
    }

    if (shouldPauseForAutomaticLoop(entry, result)) {
      return;
    }

    let sentAutomaticCustomerMessage = false;
    if (result.sendFactoryVideo) {
      const sentVideo = await sendFactoryVideoForResult(replyTarget, result);
      if (sentVideo) sentAutomaticCustomerMessage = true;
    }

    const sentReply = await sendCustomerReply(replyTarget, result.reply);
    if (sentReply) sentAutomaticCustomerMessage = true;

    if (result.completed && adminChatId) {
      await sendAdminMessage(formatNewVisitAlert(result.visit));
    }

    if (result.finalAutoReplySent) {
      logger.info('Final automatic availability reply sent; automation paused for customer', {
        customerPhone: entry.customerPhone,
        chatId: entry.from
      });
    }

    if (sentAutomaticCustomerMessage) {
      rememberAutomaticReply(entry);
      await markCustomerChatUnreadAfterBotReply(replyTarget, 'automatic_bot_reply');
    }
  } catch (error) {
    if (error && error.code === 'AUDIO_TRANSCRIPTION_REQUIRED') {
      logger.error('Failed to process queued customer audio transcription', {
        from: entry.from,
        customerPhone: entry.customerPhone,
        reason: error.reason,
        skipped: error.skipped,
        audioTranscription: getAudioTranscriptionLogInfo(),
        error
      });

      await safeReply(replyTarget, AUDIO_TRANSCRIPTION_FAILURE_REPLY);
      return;
    }

    logger.error('Failed to process grouped customer messages', {
      from: entry.from,
      customerPhone: entry.customerPhone,
      error
    });

    await safeReply(replyTarget, 'Tive um problema ao processar sua mensagem. Pode tentar novamente em instantes?');
  }
}

async function prepareQueuedCustomerMessages(entry) {
  const shouldTranscribeAudio = shouldTranscribeQueuedAudio(entry);
  const preparedMessages = [];

  for (const item of entry.messages) {
    if (item.mediaType !== 'audio' || !shouldTranscribeAudio) {
      preparedMessages.push(item);
      continue;
    }

    const transcription = await transcribeQueuedAudioItem(entry, item);
    const body = [
      String(item.body || '').trim(),
      transcription
    ].filter(Boolean).join('\n');

    preparedMessages.push({
      ...item,
      body,
      mediaType: 'text',
      transcribedAudio: true,
      sourceMessage: null
    });
  }

  return preparedMessages;
}

function shouldTranscribeQueuedAudio(entry) {
  if (!entry || !entry.messages.some((item) => item.mediaType === 'audio')) return false;
  if (isIgnoredContact(entry.customerPhone)) return false;

  return sessionManager.shouldTranscribeAudio({
    from: entry.from,
    customerPhone: entry.customerPhone
  });
}

async function transcribeQueuedAudioItem(entry, item) {
  const result = await transcribeWhatsAppAudio(item.sourceMessage);

  if (result.ok) {
    logger.info('Customer audio transcribed for automatic flow', {
      from: entry.from,
      customerPhone: entry.customerPhone,
      transcriptChars: result.text.length
    });
    return result.text;
  }

  logger.warn('Customer audio could not be transcribed', {
    from: entry.from,
    customerPhone: entry.customerPhone,
    reason: result.reason,
    skipped: result.skipped,
    audioTranscription: getAudioTranscriptionLogInfo()
  });

  throw new AudioTranscriptionRequiredError(result.reason, result.skipped);
}

function getAudioTranscriptionLogInfo() {
  const info = getAudioTranscriptionInfo();
  return {
    enabled: info.enabled,
    configured: info.configured,
    provider: info.provider,
    whisperBinaryPath: info.whisperBinaryPath,
    whisperModelPath: info.whisperModelPath,
    whisperLanguage: info.whisperLanguage,
    ffmpegPath: info.ffmpegPath,
    timeoutMs: info.timeoutMs,
    maxAudioBytes: info.maxAudioBytes,
    whisperThreads: info.whisperThreads,
    ffmpegThreads: info.ffmpegThreads,
    maxConcurrency: info.maxConcurrency,
    maxQueue: info.maxQueue,
    activeJobs: info.activeJobs,
    queuedJobs: info.queuedJobs
  };
}

function withTranscribedAudioReplyFallback(result, transcribedText) {
  if (!result || result.suppressed) return result;

  const currentReply = String(result.reply || '').trim();
  if (currentReply) return result;

  const fallbackReply = hasSchedulingIntent(transcribedText)
    ? 'Para agendar a visita técnica, pode me informar seu nome?'
    : 'Como posso ajudar? Se quiser agendar uma visita técnica, me envie seu nome, melhor dia, horário ou período preferido e o bairro ou endereço da obra.';

  return {
    ...result,
    reply: fallbackReply
  };
}

function shouldPauseForAutomaticLoop(entry, result) {
  if (!result || result.suppressed) return false;
  if (!result.reply && !result.sendFactoryVideo) return false;

  const historyKey = getAutomaticReplyHistoryKey(entry);
  if (!historyKey || config.botLoopMaxAutoReplies <= 0 || config.botLoopWindowMs <= 0) return false;

  const now = Date.now();
  const history = getRecentAutomaticReplyHistory(historyKey, now);
  if (history.length < config.botLoopMaxAutoReplies) return false;

  const stateKey = normalizeBrazilianPhoneDigits(entry.customerPhone) || getFallbackSessionKey(entry.from);
  database.pauseAutomation(stateKey, 'bot_loop_detected');
  sessionManager.clearSession(stateKey);
  clearPendingCustomerReply([entry.customerPhone, entry.from, stateKey]);
  automaticReplyHistory.delete(historyKey);

  logger.warn('Automation paused to prevent automatic bot conversation loop', {
    from: entry.from,
    customerPhone: entry.customerPhone,
    stateKey,
    automaticRepliesInWindow: history.length,
    windowMs: config.botLoopWindowMs,
    maxAutoReplies: config.botLoopMaxAutoReplies
  });

  notifyAdminBotLoopPaused(entry, stateKey, history.length).catch((error) => {
    logger.warn('Failed to notify admin about bot loop prevention', { error });
  });

  return true;
}

function rememberAutomaticReply(entry) {
  const historyKey = getAutomaticReplyHistoryKey(entry);
  if (!historyKey || config.botLoopWindowMs <= 0) return;

  const now = Date.now();
  const history = getRecentAutomaticReplyHistory(historyKey, now);
  history.push(now);
  automaticReplyHistory.set(historyKey, history);
}

function getRecentAutomaticReplyHistory(historyKey, now = Date.now()) {
  const cutoff = now - config.botLoopWindowMs;
  const history = (automaticReplyHistory.get(historyKey) || []).filter((timestamp) => timestamp >= cutoff);
  automaticReplyHistory.set(historyKey, history);
  return history;
}

function getAutomaticReplyHistoryKey(entry) {
  return normalizeBrazilianPhoneDigits(entry && entry.customerPhone) || String(entry && entry.from || '');
}

async function notifyAdminBotLoopPaused(entry, stateKey, automaticRepliesInWindow) {
  if (!adminChatId) return;

  await sendAdminMessage([
    'Atendimento automático pausado para evitar loop entre bots.',
    '',
    `Contato: ${formatBrazilianPhoneNumber(entry.customerPhone || stateKey)}`,
    `Chat: ${entry.from || 'não identificado'}`,
    `Respostas automáticas na janela: ${automaticRepliesInWindow}`,
    '',
    'Use !reset ou !reativar para liberar esse contato novamente se for um cliente real.'
  ].join('\n'));
}

function truncateForQueue(value) {
  const text = String(value || '');
  if (text.length <= config.maxQueuedMessageChars) return text;

  logger.warn('Incoming message body truncated before queueing', {
    originalLength: text.length,
    maxQueuedMessageChars: config.maxQueuedMessageChars
  });

  return text.slice(0, config.maxQueuedMessageChars);
}

function clearPendingCustomerReply(clientPhoneOrChatId) {
  const inputs = Array.isArray(clientPhoneOrChatId) ? clientPhoneOrChatId : [clientPhoneOrChatId];
  const keys = new Set();

  for (const input of inputs) {
    for (const key of buildContactStateKeys(input)) {
      keys.add(key);
    }
  }

  let clearedCount = 0;

  for (const [key, entry] of pendingCustomerMessages.entries()) {
    if (!keys.has(key) && !keys.has(entry.from) && !keys.has(entry.customerPhone)) continue;

    clearTimeout(entry.timer);
    pendingCustomerMessages.delete(key);
    clearedCount += 1;
    logger.info('Pending customer reply cancelled', {
      key,
      clientPhone: entry.customerPhone
    });
  }

  return clearedCount;
}

function clearBotOutgoingMemory(clientPhoneOrChatId) {
  const inputs = Array.isArray(clientPhoneOrChatId) ? clientPhoneOrChatId : [clientPhoneOrChatId];
  const keys = new Set();

  for (const input of inputs) {
    for (const key of buildContactStateKeys(input)) {
      keys.add(key);
    }
  }

  let clearedCount = 0;
  for (let index = botOutgoingMessages.length - 1; index >= 0; index -= 1) {
    const entry = botOutgoingMessages[index];
    if (!keys.has(entry.chatId)) continue;

    botOutgoingMessages.splice(index, 1);
    clearedCount += 1;
  }

  if (clearedCount > 0) {
    logger.info('Bot outgoing message memory cleared for reset contact', {
      clearedCount
    });
  }

  return clearedCount;
}

function clearAutomaticReplyHistory(clientPhoneOrChatId) {
  const keys = buildContactStateKeySet(clientPhoneOrChatId);
  let clearedCount = 0;

  for (const key of keys) {
    if (automaticReplyHistory.delete(key)) {
      clearedCount += 1;
    }
  }

  if (clearedCount > 0) {
    logger.info('Automatic reply loop history cleared for contact', {
      clearedCount
    });
  }

  return clearedCount;
}

function suppressNextHumanTakeover(clientPhoneOrChatId, reason) {
  if (config.humanTakeoverSuppressionMs <= 0) return 0;

  const keys = buildContactStateKeySet(clientPhoneOrChatId);
  const expiresAt = Date.now() + config.humanTakeoverSuppressionMs;

  for (const key of keys) {
    humanTakeoverSuppressions.set(key, {
      reason,
      expiresAt
    });
  }

  if (keys.size > 0) {
    logger.info('Temporary human takeover suppression registered', {
      reason,
      keyCount: keys.size,
      expiresInMs: config.humanTakeoverSuppressionMs
    });
  }

  return keys.size;
}

function consumeHumanTakeoverSuppression(clientPhoneOrChatId) {
  pruneHumanTakeoverSuppressions();

  const keys = buildContactStateKeySet(clientPhoneOrChatId);
  let matchedSuppression = null;

  for (const key of keys) {
    const suppression = humanTakeoverSuppressions.get(key);
    if (!suppression) continue;

    matchedSuppression = suppression;
    break;
  }

  if (!matchedSuppression) return null;

  for (const key of keys) {
    humanTakeoverSuppressions.delete(key);
  }

  return matchedSuppression;
}

function pruneHumanTakeoverSuppressions() {
  const now = Date.now();

  for (const [key, suppression] of humanTakeoverSuppressions.entries()) {
    if (suppression.expiresAt <= now) {
      humanTakeoverSuppressions.delete(key);
    }
  }
}

function buildContactStateKeySet(clientPhoneOrChatId) {
  const inputs = Array.isArray(clientPhoneOrChatId) ? clientPhoneOrChatId : [clientPhoneOrChatId];
  const keys = new Set();

  for (const input of inputs) {
    for (const key of buildContactStateKeys(input)) {
      keys.add(key);
    }
  }

  return keys;
}

function getCustomerQueueKey({ from, customerPhone }) {
  return normalizeBrazilianPhoneDigits(customerPhone) || String(from || '');
}

function getCustomerReplyDelayMs({ from, customerPhone }) {
  const clientPhone = normalizeBrazilianPhoneDigits(customerPhone) || resolvePhoneFromChatId(from);
  const sessionKey = clientPhone || getFallbackSessionKey(from);

  const existingSession = sessionManager.getSession(sessionKey);
  return existingSession ? config.customerFollowUpReplyDelayMs : config.customerReplyDelayMs;
}

function getFallbackSessionKey(from) {
  return `chat:${String(from || 'unknown')}`;
}

async function resolveCustomerPhone(message) {
  try {
    const contact = await withTimeout(message.getContact(), config.whatsappOperationTimeoutMs, 'message.getContact');
    const contactPhone = extractPhoneFromContact(contact);
    if (contactPhone) return contactPhone;

    if (contact && typeof contact.getFormattedNumber === 'function') {
      const formattedPhone = extractBrazilianPhoneDigits(await withTimeout(contact.getFormattedNumber(), config.whatsappOperationTimeoutMs, 'contact.getFormattedNumber'));
      if (formattedPhone) return formattedPhone;
    }
  } catch (error) {
    logger.warn('Failed to inspect WhatsApp contact for phone number', {
      from: message.from,
      error
    });
  }

  const resolvedPhone = await resolvePhoneFromWhatsAppId(message.from);
  if (resolvedPhone) return resolvedPhone;

  return resolvePhoneFromChatId(message.from);
}

async function resolvePhoneForChatId(chatId) {
  try {
    const contact = await withTimeout(client.getContactById(chatId), config.whatsappOperationTimeoutMs, 'client.getContactById');
    const contactPhone = extractPhoneFromContact(contact);
    if (contactPhone) return contactPhone;

    if (contact && typeof contact.getFormattedNumber === 'function') {
      const formattedPhone = extractBrazilianPhoneDigits(await withTimeout(contact.getFormattedNumber(), config.whatsappOperationTimeoutMs, 'contact.getFormattedNumber'));
      if (formattedPhone) return formattedPhone;
    }
  } catch (error) {
    logger.debug('Failed to resolve phone for chat id', {
      chatId,
      error
    });
  }

  return await resolvePhoneFromWhatsAppId(chatId) || resolvePhoneFromChatId(chatId);
}

function resolvePhoneFromChatId(chatId) {
  const serialized = String(chatId || '');
  if (!serialized.endsWith('@c.us')) return '';
  return extractBrazilianPhoneDigits(serialized);
}

async function resolvePhoneFromWhatsAppId(chatId) {
  if (!chatId) return '';

  const directPhone = resolvePhoneFromChatId(chatId);
  if (directPhone) return directPhone;

  if (typeof client.getContactLidAndPhone !== 'function') return '';

  try {
    const results = await withTimeout(client.getContactLidAndPhone([chatId]), config.whatsappOperationTimeoutMs, 'client.getContactLidAndPhone');
    const first = Array.isArray(results) ? results[0] : results;
    const phone = extractBrazilianPhoneDigits(first && first.pn);

    if (phone) {
      logger.info('Resolved WhatsApp LID to phone number', { chatId });
      return phone;
    }
  } catch (error) {
    logger.debug('Failed to resolve WhatsApp LID to phone number', {
      chatId,
      error
    });
  }

  return '';
}

function extractPhoneFromContact(contact) {
  if (!contact) return '';

  const candidates = [
    contact.number,
    contact.userid,
    contact.phoneNumber
  ];

  if (contact.id && contact.id.server === 'c.us') {
    candidates.push(contact.id.user, contact.id._serialized);
  }

  for (const candidate of candidates) {
    const phone = extractBrazilianPhoneDigits(candidate);
    if (phone) return phone;
  }

  return '';
}

function extractBrazilianPhoneDigits(value = '') {
  const digits = extractDigits(value);
  if (!digits) return '';

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return '';
}

async function resolveAdminChatId() {
  if (!config.adminPhoneNumber) {
    logger.warn('ADMIN_PHONE_NUMBER is not configured; admin reminders are disabled');
    return '';
  }

  if (config.adminPhoneNumber.includes('@')) {
    return config.adminPhoneNumber;
  }

  const digits = normalizeBrazilianPhoneDigits(config.adminPhoneNumber);
  if (!digits) {
    logger.warn('ADMIN_PHONE_NUMBER has no digits; admin reminders are disabled');
    return '';
  }

  try {
    const resolved = await withTimeout(client.getNumberId(digits), config.whatsappOperationTimeoutMs, 'client.getNumberId');
    if (resolved && resolved._serialized) {
      logger.info('Admin WhatsApp number resolved', {
        adminChatId: resolved._serialized
      });
      return resolved._serialized;
    }

    logger.warn('ADMIN_PHONE_NUMBER was not resolved as a registered WhatsApp user; admin reminders are disabled until this is fixed', {
      configuredCandidate: config.adminChatIdCandidate
    });
    return '';
  } catch (error) {
    logger.warn('Failed to resolve ADMIN_PHONE_NUMBER through WhatsApp; admin reminders are disabled until this is fixed', {
      configuredCandidate: config.adminChatIdCandidate,
      error
    });
    return '';
  }
}

async function sendAdminMessage(text) {
  if (!adminChatId) {
    throw new Error('Admin chat id is not configured');
  }

  try {
    return await withTimeout(client.sendMessage(adminChatId, text), config.whatsappOperationTimeoutMs, 'client.sendMessage(admin)');
  } catch (error) {
    if (!isWhatsAppLidError(error)) throw error;

    logger.warn('Admin message send hit WhatsApp LID resolution error; refreshing admin chat id and retrying once', {
      adminChatId,
      error
    });

    const refreshedAdminChatId = await resolveAdminChatId();
    if (refreshedAdminChatId && refreshedAdminChatId !== adminChatId) {
      adminChatId = refreshedAdminChatId;
      return await withTimeout(client.sendMessage(adminChatId, text), config.whatsappOperationTimeoutMs, 'client.sendMessage(admin retry)');
    }

    adminChatId = '';
    throw error;
  }
}

function isWhatsAppLidError(error) {
  const message = String(error && error.message ? error.message : error);
  return message.includes('No LID for user')
    || message.includes('LID is missing')
    || message.includes('toUserLidOrThrow');
}

async function sendCustomerReply(message, text) {
  if (!text) return null;
  if (!message || !message.from) return null;

  rememberBotOutgoing(message.from, text);
  return await withTimeout(message.reply(text, undefined, { sendSeen: false }), config.whatsappOperationTimeoutMs, 'message.reply');
}

async function sendFactoryVideo(message) {
  if (!config.factoryVideoPath) return null;

  const videoPath = path.isAbsolute(config.factoryVideoPath)
    ? config.factoryVideoPath
    : path.join(process.cwd(), config.factoryVideoPath);

  if (!fs.existsSync(videoPath)) {
    logger.warn('Factory video was configured but the file was not found. Put the file at ./media/forte-lajes-fabrica.mp4 on the VPS host, mounted as /app/media/forte-lajes-fabrica.mp4 in Docker.', {
      configuredFactoryVideoPath: config.factoryVideoPath,
      resolvedFactoryVideoPath: videoPath
    });
    return null;
  }

  const stats = fs.statSync(videoPath);
  if (config.maxFactoryVideoBytes > 0 && stats.size > config.maxFactoryVideoBytes) {
    logger.warn('Factory video skipped because it is larger than the configured limit', {
      configuredFactoryVideoPath: config.factoryVideoPath,
      resolvedFactoryVideoPath: videoPath,
      sizeBytes: stats.size,
      maxFactoryVideoBytes: config.maxFactoryVideoBytes
    });
    return null;
  }

  const media = MessageMedia.fromFilePath(videoPath);
  const caption = config.factoryVideoCaption || '';
  rememberBotOutgoing(message.from, caption);

  return await withTimeout(client.sendMessage(message.from, media, {
    ...(caption ? { caption } : {}),
    sendSeen: false
  }), config.whatsappOperationTimeoutMs, 'client.sendMessage(media)');
}

async function sendFactoryVideoForResult(message, result) {
  try {
    const sentMessage = await sendFactoryVideo(message);
    if (sentMessage && result.factoryVideoKey) {
      database.recordContactEvent(result.factoryVideoKey, FACTORY_VIDEO_SENT_EVENT);
    }
    return sentMessage;
  } catch (error) {
    logger.error('Failed to send factory video during first-contact welcome flow', {
      to: message.from,
      configuredFactoryVideoPath: config.factoryVideoPath,
      error
    });
    return null;
  }
}

async function markCustomerChatUnreadAfterBotReply(message, reason) {
  if (!config.markBotRepliesUnread) return;

  const chatId = message && message.from;
  if (!chatId || isGroupMessage(chatId) || isAdmin(chatId)) return;

  if (typeof client.markChatUnread !== 'function') {
    logger.warn('WhatsApp client does not support markChatUnread; customer chat cannot be marked unread after bot reply', {
      chatId,
      reason
    });
    return;
  }

  try {
    await withTimeout(client.markChatUnread(chatId), config.whatsappOperationTimeoutMs, 'client.markChatUnread');
    logger.info('Customer chat marked unread after bot automatic reply', {
      chatId,
      reason
    });
  } catch (error) {
    logger.warn('Failed to mark customer chat as unread after bot automatic reply', {
      chatId,
      reason,
      error
    });
  }
}

function rememberBotOutgoing(chatId, body) {
  pruneBotOutgoingMessages();
  botOutgoingMessages.push({
    chatId,
    body: String(body || '').trim(),
    expiresAt: Date.now() + 30000
  });
}

function wasSentByBot(chatId, body) {
  pruneBotOutgoingMessages();
  const normalizedBody = String(body || '').trim();
  const index = botOutgoingMessages.findIndex((entry) => entry.chatId === chatId && entry.body === normalizedBody);

  if (index === -1) return false;

  botOutgoingMessages.splice(index, 1);
  return true;
}

function pruneBotOutgoingMessages() {
  const now = Date.now();
  for (let index = botOutgoingMessages.length - 1; index >= 0; index -= 1) {
    if (botOutgoingMessages[index].expiresAt <= now) {
      botOutgoingMessages.splice(index, 1);
    }
  }
}

function isAdmin(chatId) {
  return Boolean(chatId && adminChatId && chatId === adminChatId)
    || sameWhatsAppContact(chatId, config.adminPhoneNumber);
}

function isIgnoredContact(clientPhone) {
  return Boolean(clientPhone && database.isContactIgnored(clientPhone));
}

function isGroupMessage(chatId) {
  return String(chatId || '').endsWith('@g.us');
}

function isSystemBroadcastMessage(message) {
  const candidates = [
    message && message.from,
    message && message.to,
    message && message.id && message.id.remote,
    message && message._data && message._data.from,
    message && message._data && message._data.to
  ];

  return candidates.some((candidate) => String(candidate || '').endsWith('@broadcast'));
}

function isAudioMessage(message) {
  const type = String(message.type || '').toLowerCase();
  return Boolean(message.hasMedia && (type === 'audio' || type === 'ptt' || type === 'voice'));
}

function getMessageDate(message) {
  if (message.timestamp) {
    return new Date(Number(message.timestamp) * 1000);
  }

  return new Date();
}

function formatNewVisitAlert(visit) {
  return [
    'Nova solicitação de visita técnica',
    '',
    `Protocolo: #${visit.id}`,
    `Cliente: ${visit.client_name}`,
    `Dia da visita: ${formatDateBr(visit.visit_date)}`,
    `Bairro/região: ${visit.neighborhood || visit.address || 'Não informado'}`,
    ...formatVisitAddressLines(visit),
    `WhatsApp: ${formatBrazilianPhoneNumber(visit.client_phone)}`,
    `Horário: ${visit.visit_time || 'A combinar'}`,
    ...formatVisitNoteLines(visit),
    '',
    'Um funcionário deve continuar o atendimento por mensagem para combinar os detalhes.'
  ].join('\n');
}

function formatWeeklyVisits(visits, startDate, endDate) {
  if (!visits.length) {
    return `Nenhuma visita agendada entre ${formatDateBr(startDate)} e ${formatDateBr(endDate)}.`;
  }

  const lines = visits.map((visit, index) => [
    `${index + 1}. Protocolo: #${visit.id}`,
    `Cliente: ${visit.client_name || 'Não informado'}`,
    `Dia da visita: ${formatDateBr(visit.visit_date)}`,
    `Horário: ${visit.visit_time || 'A combinar'}`,
    `Bairro/região: ${visit.neighborhood || visit.address || 'Não informado'}`,
    ...formatVisitAddressLines(visit),
    `WhatsApp: ${formatBrazilianPhoneNumber(visit.client_phone)}`,
    ...formatVisitNoteLines(visit)
  ].join('\n'));

  return `Visitas entre ${formatDateBr(startDate)} e ${formatDateBr(endDate)}:\n\n${lines.join('\n\n')}`;
}

function formatVisitNoteLines(visit) {
  const notes = String(visit && visit.notes ? visit.notes : '').trim();
  return notes ? [`Observações: ${notes}`] : [];
}

function formatVisitAddressLines(visit) {
  const address = String(visit && visit.address ? visit.address : '').trim();
  const neighborhood = String(visit && visit.neighborhood ? visit.neighborhood : '').trim();

  if (!address || address === neighborhood) return [];
  return [`Endereço/local: ${address}`];
}

function formatDateBr(dateKey) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

function formatDateTimeBr(date = new Date(), timezone = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseMultilineEnv(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.replace(/\\n/g, '\n');
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;

  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function startWhatsAppWatchdog() {
  if (whatsappWatchdogTimer || config.whatsappWatchdogIntervalMs <= 0) return;

  whatsappWatchdogTimer = setInterval(() => {
    checkWhatsAppHealth().catch((error) => {
      logger.warn('WhatsApp watchdog check failed unexpectedly', { error });
    });
  }, config.whatsappWatchdogIntervalMs);

  if (typeof whatsappWatchdogTimer.unref === 'function') {
    whatsappWatchdogTimer.unref();
  }
}

async function checkWhatsAppHealth() {
  if (!whatsappReady) return;

  try {
    const state = typeof client.getState === 'function'
      ? await withTimeout(client.getState(), config.whatsappWatchdogTimeoutMs, 'client.getState')
      : 'UNKNOWN';

    if (['CONFLICT', 'TIMEOUT', 'UNPAIRED', 'UNPAIRED_IDLE'].includes(String(state || '').toUpperCase())) {
      throw new Error(`WhatsApp state is ${state}`);
    }

    whatsappWatchdogFailures = 0;
  } catch (error) {
    whatsappWatchdogFailures += 1;
    logger.warn('WhatsApp watchdog failure', {
      failures: whatsappWatchdogFailures,
      maxFailures: config.whatsappWatchdogMaxFailures,
      error
    });

    if (whatsappWatchdogFailures >= config.whatsappWatchdogMaxFailures) {
      logger.error('WhatsApp watchdog failure limit reached; exiting for Docker restart', {
        failures: whatsappWatchdogFailures
      });
      process.exit(1);
    }
  }
}

async function safeReply(message, text) {
  if (!message) return;

  try {
    const sentReply = await sendCustomerReply(message, text);
    if (sentReply) {
      await markCustomerChatUnreadAfterBotReply(message, 'automatic_fallback_reply');
    }
  } catch (error) {
    logger.error('Failed to send fallback reply', {
      to: message.from,
      error
    });
  }
}

async function shutdown(signal) {
  logger.info('Shutdown requested', { signal });

  if (cronController) cronController.stopAll();
  if (whatsappWatchdogTimer) clearInterval(whatsappWatchdogTimer);
  for (const entry of pendingCustomerMessages.values()) {
    clearTimeout(entry.timer);
  }
  pendingCustomerMessages.clear();

  try {
    await client.destroy();
  } catch (error) {
    logger.warn('WhatsApp client destroy failed during shutdown', { error });
  }

  await closeHealthServer();
  database.close();
  process.exit(0);
}

function closeHealthServer() {
  if (!healthServer) return Promise.resolve();

  return new Promise((resolve) => {
    healthServer.close((error) => {
      if (error) {
        logger.warn('Health server shutdown failed', { error });
      }

      resolve();
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection', { error });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

logger.info('Starting WhatsApp bot', {
  adminConfigured: Boolean(extractDigits(config.adminPhoneNumber)),
  authDataPath: config.authDataPath,
  dbPath: config.sqliteDbPath,
  serviceHost: config.serviceHost,
  servicePort: config.servicePort,
  cronTimezone: config.cronTimezone,
  customerReplyDelayMs: config.customerReplyDelayMs,
  customerFollowUpReplyDelayMs: config.customerFollowUpReplyDelayMs,
  customerAiAssistantEnabled: config.customerAiAssistantEnabled,
  factoryVideoConfigured: Boolean(config.factoryVideoPath),
  audioTranscription: getAudioTranscriptionInfo(),
  ai: getAiServiceInfo()
});

logFactoryVideoConfiguration();
healthServer = startHealthServer();
startWhatsAppClient();

function logFactoryVideoConfiguration() {
  if (!config.factoryVideoPath) {
    logger.warn('FACTORY_VIDEO_PATH is not configured; the first-contact welcome video will not be sent.');
    return;
  }

  const videoPath = path.isAbsolute(config.factoryVideoPath)
    ? config.factoryVideoPath
    : path.join(process.cwd(), config.factoryVideoPath);

  if (!fs.existsSync(videoPath)) {
    logger.warn('Factory video file is missing. On the VPS, store it at /opt/whatsapp-bot/media/forte-lajes-fabrica.mp4 and keep FACTORY_VIDEO_PATH=/app/media/forte-lajes-fabrica.mp4.', {
      configuredFactoryVideoPath: config.factoryVideoPath,
      resolvedFactoryVideoPath: videoPath
    });
    return;
  }

  logger.info('Factory video file found', {
    configuredFactoryVideoPath: config.factoryVideoPath,
    resolvedFactoryVideoPath: videoPath
  });
}

function startHealthServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    const headersOnly = request.method === 'HEAD';
    const allowedMethod = request.method === 'GET' || headersOnly;

    if (!allowedMethod) {
      sendJson(response, 405, { status: 'method_not_allowed' }, headersOnly);
      return;
    }

    if (requestUrl.pathname !== '/' && requestUrl.pathname !== '/health') {
      sendJson(response, 404, { status: 'not_found' }, headersOnly);
      return;
    }

    sendJson(response, 200, {
      status: 'ok',
      service: 'whatsapp-scheduling-bot',
      aiProvider: getAiProviderLabel(),
      customerAiAssistant: {
        enabled: config.customerAiAssistantEnabled
      },
      audioTranscription: getAudioTranscriptionInfo(),
      botLoop: {
        windowMs: config.botLoopWindowMs,
        maxAutoReplies: config.botLoopMaxAutoReplies,
        trackedContacts: automaticReplyHistory.size
      },
      whatsappReady,
      watchdogFailures: whatsappWatchdogFailures,
      pendingCustomers: pendingCustomerMessages.size,
      sessionCacheEntries: sessionManager.getCacheSize(),
      startedAt,
      uptimeSeconds: Math.floor(process.uptime())
    }, headersOnly);
  });

  server.on('error', (error) => {
    logger.error('Health server failed', {
      host: config.serviceHost,
      port: config.servicePort,
      error
    });
    process.exit(1);
  });

  server.listen(config.servicePort, config.serviceHost, () => {
    logger.info('Health server listening', {
      host: config.serviceHost,
      port: config.servicePort
    });
  });

  return server;
}

function sendJson(response, statusCode, data, headersOnly = false) {
  const body = JSON.stringify(data);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(headersOnly ? undefined : body);
}

async function startWhatsAppClient() {
  if (config.cleanupChromiumProfileLocks) {
    cleanupStaleChromiumProfileLocks(config.authDataPath);
  }

  try {
    await client.initialize();
  } catch (error) {
    whatsappReady = false;
    logger.error('WhatsApp client initialization failed', { error });

    if (config.cleanupChromiumProfileLocks && isChromiumProfileLockError(error)) {
      cleanupStaleChromiumProfileLocks(config.authDataPath);
    }

    process.exit(1);
  }
}

module.exports = {
  handleLLMQuery
};
