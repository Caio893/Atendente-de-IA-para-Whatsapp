const { addDaysToDateKey, extractDigits, getDateKeyInTimezone } = require('./utils');
const { handleCustomerAssistantTurn } = require('./aiService');

const STEPS = {
  ASSISTANT: 'assistant',
  GREETED: 'greeted',
  NAME: 'name',
  DAY: 'day',
  NEIGHBORHOOD: 'neighborhood',
  FINAL_PENDING: 'final_pending'
};

const FACTORY_VIDEO_SENT_EVENT = 'factory_video_sent';
const MAX_NAME_CHARS = 80;
const MAX_NAME_WORDS = 6;
const MAX_NAME_PROMPTS = 3;

const NON_NAME_EXACT_PHRASES = new Set([
  'alo',
  'beleza',
  'blz',
  'boa noite',
  'boa tarde',
  'bom dia',
  'certo',
  'nao',
  'nao sei',
  'nao tenho',
  'ok',
  'okay',
  'oi',
  'ola',
  'pode sim',
  'pode ser',
  'por favor',
  'sim',
  'tudo bem',
  'valeu'
]);

const NON_NAME_WORDS = new Set([
  'agendamento',
  'atendente',
  'bairro',
  'casa',
  'cliente',
  'colocar',
  'coloque',
  'endereco',
  'funcionario',
  'gostaria',
  'humano',
  'laje',
  'lajes',
  'medicao',
  'metro',
  'metros',
  'nome',
  'obrigada',
  'obrigado',
  'orcamento',
  'pergunta',
  'preciso',
  'preco',
  'quero',
  'queria',
  'regiao',
  'saber',
  'telefone',
  'valor',
  'virtual',
  'visita',
  'whatsapp',
  'zap'
]);

const NAME_CONNECTORS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
const KNOWN_RIO_NEIGHBORHOODS = [
  'Abolição',
  'Acari',
  'Água Santa',
  'Alto da Boa Vista',
  'Anchieta',
  'Andaraí',
  'Anil',
  'Bancários',
  'Bangu',
  'Barra da Tijuca',
  'Barra de Guaratiba',
  'Barros Filho',
  'Benfica',
  'Bento Ribeiro',
  'Bonsucesso',
  'Botafogo',
  'Brás de Pina',
  'Cachambi',
  'Cacuia',
  'Caju',
  'Camorim',
  'Campinho',
  'Campo Grande',
  'Campo dos Afonsos',
  'Cascadura',
  'Catete',
  'Catumbi',
  'Cavalcanti',
  'Centro',
  'Cidade de Deus',
  'Cidade Nova',
  'Cidade Universitária',
  'Cocotá',
  'Coelho Neto',
  'Colégio',
  'Complexo do Alemão',
  'Copacabana',
  'Cordovil',
  'Cosme Velho',
  'Cosmos',
  'Costa Barros',
  'Curicica',
  'Del Castilho',
  'Deodoro',
  'Encantado',
  'Engenheiro Leal',
  'Engenho da Rainha',
  'Engenho de Dentro',
  'Engenho Novo',
  'Estácio',
  'Flamengo',
  'Freguesia',
  'Galeão',
  'Gamboa',
  'Gardênia Azul',
  'Gávea',
  'Gericinó',
  'Glória',
  'Grajaú',
  'Grumari',
  'Guadalupe',
  'Guaratiba',
  'Higienópolis',
  'Honório Gurgel',
  'Humaitá',
  'Inhaúma',
  'Inhoaíba',
  'Ipanema',
  'Irajá',
  'Itanhangá',
  'Jacaré',
  'Jacarepaguá',
  'Jardim América',
  'Jardim Botânico',
  'Jardim Carioca',
  'Jardim Guanabara',
  'Jardim Sulacap',
  'Joá',
  'Lagoa',
  'Lapa',
  'Laranjeiras',
  'Leblon',
  'Leme',
  'Lins de Vasconcelos',
  'Madureira',
  'Magalhães Bastos',
  'Mangueira',
  'Manguinhos',
  'Maracanã',
  'Maré',
  'Marechal Hermes',
  'Maria da Graça',
  'Méier',
  'Moneró',
  'Olaria',
  'Oswaldo Cruz',
  'Paciência',
  'Padre Miguel',
  'Paquetá',
  'Parada de Lucas',
  'Parque Anchieta',
  'Parque Colúmbia',
  'Pavuna',
  'Pechincha',
  'Pedra de Guaratiba',
  'Penha',
  'Penha Circular',
  'Piedade',
  'Pilares',
  'Pitangueiras',
  'Portuguesa',
  'Praça da Bandeira',
  'Praça Seca',
  'Quintino Bocaiúva',
  'Ramos',
  'Realengo',
  'Recreio dos Bandeirantes',
  'Riachuelo',
  'Ribeira',
  'Ricardo de Albuquerque',
  'Rio Comprido',
  'Rocha',
  'Rocha Miranda',
  'Rocinha',
  'Sampaio',
  'Santa Cruz',
  'Santa Teresa',
  'Santíssimo',
  'Santo Cristo',
  'São Conrado',
  'São Cristóvão',
  'São Francisco Xavier',
  'Saúde',
  'Senador Camará',
  'Senador Vasconcelos',
  'Sepetiba',
  'Tanque',
  'Taquara',
  'Tauá',
  'Tijuca',
  'Todos os Santos',
  'Tomás Coelho',
  'Turiaçu',
  'Urca',
  'Vargem Grande',
  'Vargem Pequena',
  'Vasco da Gama',
  'Vaz Lobo',
  'Vicente de Carvalho',
  'Vidigal',
  'Vigário Geral',
  'Vila Isabel',
  'Vila Kosmos',
  'Vila Militar',
  'Vila Valqueire',
  'Vista Alegre',
  'Zumbi'
];
const KNOWN_RIO_NEIGHBORHOOD_ALIASES = new Map([
  ['barra', 'Barra da Tijuca'],
  ['barra tijuca', 'Barra da Tijuca'],
  ['recreio', 'Recreio dos Bandeirantes'],
  ['recreio dos bandeirante', 'Recreio dos Bandeirantes'],
  ['jacarepagua', 'Jacarepaguá'],
  ['jacarepagu', 'Jacarepaguá'],
  ['jacare pagua', 'Jacarepaguá'],
  ['jacare pagu', 'Jacarepaguá'],
  ['jakara pagua', 'Jacarepaguá'],
  ['jakara pagu', 'Jacarepaguá'],
  ['jacara pagua', 'Jacarepaguá'],
  ['jacara pagu', 'Jacarepaguá'],
  ['meier', 'Méier'],
  ['grajau', 'Grajaú'],
  ['iraja', 'Irajá'],
  ['inhuma', 'Inhaúma'],
  ['inhau', 'Inhaúma'],
  ['tijuka', 'Tijuca'],
  ['sao conrado', 'São Conrado'],
  ['sao cristovao', 'São Cristóvão'],
  ['sao francisco xavier', 'São Francisco Xavier'],
  ['santa tereza', 'Santa Teresa'],
  ['vila valqueire', 'Vila Valqueire'],
  ['vila kosmos', 'Vila Kosmos']
]);
const KNOWN_RIO_NEIGHBORHOOD_MATCHES = KNOWN_RIO_NEIGHBORHOODS.map((label) => {
  const normalized = normalizeForMatch(label).replace(/\s+/g, ' ').trim();
  return {
    label,
    normalized,
    compact: normalized.replace(/\s+/g, '')
  };
});

const AVAILABILITY_MESSAGE = [
  'Obrigado por entrar em contato com a Forte Lajes.',
  '',
  'No momento não há um funcionário disponível para atender.',
  '',
  'Deixe sua mensagem por aqui que responderemos assim que possível.',
  '',
  'Para parar o atendimento automático, envie "sair".'
].join('\n');

const WELCOME_MESSAGE = AVAILABILITY_MESSAGE;

class SessionManager {
  constructor(database, options = {}) {
    this.database = database;
    this.timezone = options.timezone || 'America/Sao_Paulo';
    this.cache = new Map();
    this.maxCacheEntries = parsePositiveInteger(options.maxCacheEntries, 1000);
    this.cacheTtlMs = parsePositiveInteger(options.cacheTtlMs, 24 * 60 * 60 * 1000);
    this.customerAssistantEnabled = options.customerAssistantEnabled !== false;
    this.customerAssistant = options.customerAssistant || handleCustomerAssistantTurn;
  }

  async handleIncomingMessage({ from, customerPhone, body, receivedAt = new Date(), mediaType = 'text', transcribedAudio = false }) {
    const resolvedClientPhone = resolveClientPhone({ from, customerPhone });
    const sessionKey = resolvedClientPhone || resolveSessionKey(from);
    const text = String(body || '').trim();

    const existingSession = this.getSession(sessionKey);

    if (this.database.isAutomationPaused(sessionKey)) {
      return { suppressed: true };
    }

    if (existingSession && existingSession.step === STEPS.FINAL_PENDING) {
      return this.handleFinalPendingMessage(sessionKey);
    }

    if (text && isCancelIntent(text)) {
      this.database.pauseAutomation(sessionKey, 'customer_requested_exit');
      this.clearSession(sessionKey);
      return { reply: 'Tudo certo, parei o atendimento automático por aqui. Um funcionário da Forte Lajes continuará o atendimento assim que possível.' };
    }

    if (!text) {
      return this.handleEmptyMessage(sessionKey, existingSession, mediaType);
    }

    if (this.customerAssistantEnabled) {
      const assistantResult = await this.handleCustomerAssistantMessage({
        sessionKey,
        text,
        receivedAt,
        resolvedClientPhone,
        existingSession,
        transcribedAudio
      });

      if (assistantResult) return assistantResult;
    }

    return this.handleRuleBasedTextMessage({
      sessionKey,
      text,
      receivedAt,
      resolvedClientPhone,
      existingSession
    });
  }

  handleRuleBasedTextMessage({ sessionKey, text, receivedAt, resolvedClientPhone, existingSession }) {
    if (!existingSession) {
      return this.handleFirstMessage(sessionKey, text, receivedAt, resolvedClientPhone);
    }

    if (existingSession.step === 'assistant_opt_in') {
      return this.startActivatedBotFlow(sessionKey, text, receivedAt, resolvedClientPhone);
    }

    if (existingSession.step === STEPS.GREETED) {
      return this.handleGreetedMessage(sessionKey, existingSession.data, text, receivedAt, resolvedClientPhone);
    }

    return this.continueScheduling(sessionKey, existingSession.step, existingSession.data, text, receivedAt, resolvedClientPhone);
  }

  async handleCustomerAssistantMessage({ sessionKey, text, receivedAt, resolvedClientPhone, existingSession, transcribedAudio = false }) {
    const shouldSendFactoryVideo = !this.database.hasContactEvent(sessionKey, FACTORY_VIDEO_SENT_EVENT);
    const shouldSendInitialWelcome = !existingSession;
    const previousData = getAssistantSessionData(existingSession);
    const expectedStep = existingSession && existingSession.step !== STEPS.ASSISTANT
      ? existingSession.step
      : undefined;
    const localExtraction = extractSchedulingData(text, {
      receivedAt,
      timezone: this.timezone,
      allowLooseDay: true,
      expectedStep
    });
    const baseData = mergeSchedulingData(previousData, localExtraction.data, {
      clientPhone: resolvedClientPhone || extractBrazilianPhoneDigits(sessionKey)
    });
    const assistantTurn = await this.customerAssistant({
      message: text,
      sessionData: baseData,
      receivedAt,
      timezone: this.timezone,
      customerPhone: resolvedClientPhone || extractBrazilianPhoneDigits(sessionKey)
    });

    if (!assistantTurn.ok) return null;

    const data = normalizeAssistantSchedulingData(mergeSchedulingData(baseData, assistantTurn.data), {
      receivedAt,
      timezone: this.timezone,
      currentText: text,
      previousData,
      localData: localExtraction.data
    });
    const complete = isAssistantVisitComplete(data);

    if (complete) {
      const visit = this.createVisitRequest(sessionKey, data);
      const result = this.completeVisitRequest(visit);
      if (shouldSendInitialWelcome) {
        result.reply = [WELCOME_MESSAGE, '', result.reply].join('\n');
      }
      return {
        ...result,
        sendFactoryVideo: shouldSendFactoryVideo,
        factoryVideoKey: sessionKey
      };
    }

    if (transcribedAudio && hasSchedulingIntent(text)) {
      const ruleResult = this.startRuleBasedSchedulingFromTranscribedAudio({
        sessionKey,
        data,
        receivedAt,
        resolvedClientPhone,
        shouldSendInitialWelcome
      });

      return {
        ...ruleResult,
        sendFactoryVideo: shouldSendFactoryVideo,
        factoryVideoKey: sessionKey
      };
    }

    const incomplete = this.prepareIncompleteAssistantReply({
      data,
      assistantReply: assistantTurn.reply,
      sessionKey
    });

    if (incomplete.paused) {
      return {
        reply: addInitialWelcomeIfNeeded(incomplete.reply, shouldSendInitialWelcome),
        sendFactoryVideo: shouldSendFactoryVideo,
        factoryVideoKey: sessionKey
      };
    }

    const reply = addInitialWelcomeIfNeeded(
      incomplete.reply,
      shouldSendInitialWelcome
    );
    this.saveSession(sessionKey, {
      step: STEPS.ASSISTANT,
      data: {
        ...incomplete.data,
        recentMessages: appendRecentMessages(previousData.recentMessages, text, reply)
      }
    });

    return {
      reply,
      sendFactoryVideo: shouldSendFactoryVideo,
      factoryVideoKey: sessionKey
    };
  }

  startRuleBasedSchedulingFromTranscribedAudio({ sessionKey, data, receivedAt, resolvedClientPhone, shouldSendInitialWelcome }) {
    const result = this.advanceScheduling(sessionKey, withResolvedPhone(data, resolvedClientPhone), receivedAt);

    if (shouldSendInitialWelcome) {
      return {
        ...result,
        reply: [WELCOME_MESSAGE, '', result.reply].join('\n')
      };
    }

    return result;
  }

  prepareIncompleteAssistantReply({ data, assistantReply, sessionKey }) {
    if (!data.clientName) {
      const nextData = incrementNamePromptCount(data);

      if (shouldPauseForMissingName(nextData)) {
        this.database.pauseAutomation(sessionKey, 'name_not_identified');
        this.clearSession(sessionKey);
        return {
          paused: true,
          data: nextData,
          reply: getNamePrompt(nextData.namePromptCount)
        };
      }

      return {
        paused: false,
        data: nextData,
        reply: getNamePrompt(nextData.namePromptCount)
      };
    }

    return {
      paused: false,
      data,
      reply: buildAssistantFollowUpReply(assistantReply, data)
    };
  }

  shouldTranscribeAudio({ from, customerPhone }) {
    const resolvedClientPhone = resolveClientPhone({ from, customerPhone });
    const sessionKey = resolvedClientPhone || resolveSessionKey(from);

    if (this.database.isAutomationPaused(sessionKey)) return false;

    const existingSession = this.getSession(sessionKey);
    if (existingSession && existingSession.step === STEPS.FINAL_PENDING) return false;

    return true;
  }

  getSession(clientPhone) {
    const cached = this.cache.get(clientPhone);
    if (cached) {
      if (cached.expiresAt <= Date.now()) {
        this.cache.delete(clientPhone);
      } else {
        this.touchCachedSession(clientPhone, cached);
        return cached.session;
      }
    }

    const persisted = this.database.getSession(clientPhone);
    if (!persisted) return null;

    const session = { step: persisted.step, data: persisted.data || {} };
    this.setCachedSession(clientPhone, session);
    return session;
  }

  handleFirstMessage(clientPhone, text, receivedAt, resolvedClientPhone = '') {
    return this.startActivatedBotFlow(clientPhone, text, receivedAt, resolvedClientPhone);
  }

  startActivatedBotFlow(clientPhone, text, receivedAt, resolvedClientPhone = '') {
    const shouldSendFactoryVideo = !this.database.hasContactEvent(clientPhone, FACTORY_VIDEO_SENT_EVENT);

    if (!hasSchedulingIntent(text)) {
      this.saveSession(clientPhone, {
        step: STEPS.GREETED,
        data: {
          clientPhone: resolvedClientPhone || extractBrazilianPhoneDigits(clientPhone)
        }
      });
      return {
        reply: WELCOME_MESSAGE,
        sendFactoryVideo: shouldSendFactoryVideo,
        factoryVideoKey: clientPhone
      };
    }

    const extracted = extractSchedulingData(text, {
      receivedAt,
      timezone: this.timezone,
      allowLooseDay: false
    });

    const result = this.advanceScheduling(clientPhone, withResolvedPhone(extracted.data, resolvedClientPhone), receivedAt);
    return {
      ...result,
      reply: [WELCOME_MESSAGE, '', result.reply].join('\n'),
      sendFactoryVideo: shouldSendFactoryVideo,
      factoryVideoKey: clientPhone
    };
  }

  handleGreetedMessage(clientPhone, existingData, text, receivedAt, resolvedClientPhone = '') {
    if (!hasSchedulingIntent(text)) {
      return { reply: null };
    }

    const extracted = extractSchedulingData(text, {
      receivedAt,
      timezone: this.timezone,
      allowLooseDay: false
    });

    return this.advanceScheduling(clientPhone, withResolvedPhone({
      ...(existingData || {}),
      ...extracted.data
    }, resolvedClientPhone), receivedAt, {
      startedFromGreeting: true
    });
  }

  continueScheduling(clientPhone, currentStep, currentData, text, receivedAt, resolvedClientPhone = '') {
    const extracted = extractSchedulingData(text, {
      receivedAt,
      timezone: this.timezone,
      allowLooseDay: true,
      expectedStep: currentStep
    });

    const data = {
      ...currentData,
      ...extracted.data
    };

    return this.advanceScheduling(clientPhone, withResolvedPhone(data, resolvedClientPhone), receivedAt);
  }

  advanceScheduling(clientPhone, data) {
    data = normalizeSchedulingData(data);

    if (data.visitDateError && !data.visitDate) {
      const nextData = { ...data };
      delete nextData.visitDateError;
      const nextStep = data.clientName ? STEPS.DAY : STEPS.NAME;
      const nextQuestion = data.clientName
        ? 'Pode me informar outro dia para a visita?'
        : 'Para solicitar uma visita técnica, por favor me informe seu nome.';

      this.saveSession(clientPhone, { step: nextStep, data: nextData });
      return {
        reply: [
          data.visitDateError,
          '',
          nextQuestion
        ].join('\n')
      };
    }

    if (!data.clientName) {
      const nextData = incrementNamePromptCount(data);

      if (shouldPauseForMissingName(nextData)) {
        this.database.pauseAutomation(clientPhone, 'name_not_identified');
        this.clearSession(clientPhone);
        return { reply: getNamePrompt(nextData.namePromptCount) };
      }

      this.saveSession(clientPhone, { step: STEPS.NAME, data: nextData });
      return { reply: getNamePrompt(nextData.namePromptCount) };
    }

    if (!data.visitDate || !data.visitTime) {
      this.saveSession(clientPhone, { step: STEPS.DAY, data });
      return {
        reply: getDateTimePrompt(data)
      };
    }

    if (!data.neighborhood) {
      this.saveSession(clientPhone, { step: STEPS.NEIGHBORHOOD, data });
      return { reply: 'Qual é o bairro?' };
    }

    const visit = this.createVisitRequest(clientPhone, data);
    return this.completeVisitRequest(visit);
  }

  handleEmptyMessage(clientPhone, existingSession, mediaType) {
    if (mediaType === 'audio') {
      return { reply: 'Tive um problema ao transcrever seu audio. Pode tentar enviar novamente em instantes?' };
    }

    const message = 'Recebi sua mensagem, mas não consegui identificar um texto. Pode enviar por escrito, por favor?';

    if (!existingSession) {
      this.saveSession(clientPhone, { step: STEPS.GREETED, data: {} });
    }

    return { reply: message };
  }

  createVisitRequest(clientPhone, data) {
    const visit = this.database.createVisit({
      clientName: data.clientName,
      clientPhone: data.clientPhone || extractBrazilianPhoneDigits(clientPhone),
      address: data.address || data.neighborhood,
      neighborhood: data.neighborhood,
      visitDate: data.visitDate,
      visitTime: data.visitTime || 'A combinar',
      notes: data.notes
    });

    this.saveSession(clientPhone, {
      step: STEPS.FINAL_PENDING,
      data: { visitId: visit.id }
    });
    return visit;
  }

  completeVisitRequest(visit) {
    return {
      completed: true,
      visit,
      reply: [
        `Perfeito, ${visit.client_name}. Registrei sua solicitação de visita técnica para ${formatDateBr(visit.visit_date)}.`,
        `Horário/período: ${visit.visit_time || 'A combinar'}`,
        `Bairro/região: ${visit.neighborhood || visit.address}`,
        ...(visit.address && visit.address !== visit.neighborhood ? [`Endereço/local: ${visit.address}`] : []),
        ...(visit.notes ? [`Observações: ${visit.notes}`] : []),
        '',
        `Protocolo: #${visit.id}`,
        '',
        'Um funcionário da Forte Lajes vai continuar o atendimento por mensagem para confirmar o horário e os detalhes.'
      ].join('\n')
    };
  }

  handleFinalPendingMessage(clientPhone) {
    this.database.pauseAutomation(clientPhone, 'visit_completed_follow_up');
    this.clearSession(clientPhone);

    return {
      reply: AVAILABILITY_MESSAGE,
      finalAutoReplySent: true
    };
  }

  saveSession(clientPhone, session) {
    this.setCachedSession(clientPhone, session);
    this.database.saveSession(clientPhone, session.step, session.data);
  }

  clearSession(clientPhone) {
    this.cache.delete(clientPhone);
    this.database.deleteSession(clientPhone);
  }

  clearSessions(clientPhones) {
    for (const clientPhone of clientPhones) {
      this.clearSession(clientPhone);
    }
  }

  getCacheSize() {
    this.pruneCache();
    return this.cache.size;
  }

  setCachedSession(clientPhone, session) {
    this.cache.delete(clientPhone);
    this.cache.set(clientPhone, {
      session,
      expiresAt: Date.now() + this.cacheTtlMs
    });
    this.pruneCache();
  }

  touchCachedSession(clientPhone, cached) {
    this.cache.delete(clientPhone);
    this.cache.set(clientPhone, {
      session: cached.session,
      expiresAt: Date.now() + this.cacheTtlMs
    });
  }

  pruneCache() {
    const now = Date.now();
    for (const [clientPhone, cached] of this.cache.entries()) {
      if (cached.expiresAt <= now) {
        this.cache.delete(clientPhone);
      }
    }

    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }
}

function getAssistantSessionData(existingSession) {
  if (!existingSession || existingSession.step === STEPS.FINAL_PENDING) return {};
  return {
    ...(existingSession.data || {}),
    recentMessages: Array.isArray(existingSession.data && existingSession.data.recentMessages)
      ? existingSession.data.recentMessages
      : []
  };
}

function mergeSchedulingData(...sources) {
  const fields = ['clientName', 'clientPhone', 'visitDate', 'visitTime', 'address', 'neighborhood', 'notes', 'namePromptCount'];
  const merged = {};

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    for (const field of fields) {
      const value = source[field];
      if (value === undefined || value === null) continue;

      const text = String(value).trim();
      if (!text) continue;

      merged[field] = text;
    }
  }

  return merged;
}

function normalizeAssistantSchedulingData(data = {}, { receivedAt, timezone, currentText = '', previousData = {}, localData = {} } = {}) {
  const normalized = normalizeSchedulingData(data);

  if (normalized.clientName && !isClientNameGrounded(normalized.clientName, {
    currentText,
    previousData,
    localData
  })) {
    delete normalized.clientName;
  }

  normalized.clientPhone = extractBrazilianPhoneDigits(data.clientPhone);
  normalized.address = normalizeAddress(data.address);
  normalized.visitTime = normalizeVisitTime(data.visitTime);
  normalized.notes = normalizeNotes(data.notes);
  normalized.namePromptCount = parseNonNegativeInteger(data.namePromptCount, 0);

  const parsedDate = normalizeAssistantVisitDate(data.visitDate, {
    receivedAt,
    timezone
  });

  if (parsedDate.visitDate) {
    normalized.visitDate = parsedDate.visitDate;
  } else {
    delete normalized.visitDate;
  }

  if (parsedDate.visitDateError) {
    normalized.visitDateError = parsedDate.visitDateError;
  }

  if (!normalized.address) delete normalized.address;
  if (!normalized.visitTime) delete normalized.visitTime;
  if (!normalized.notes) delete normalized.notes;
  if (!normalized.namePromptCount) delete normalized.namePromptCount;

  return normalized;
}

function isClientNameGrounded(clientName, { currentText = '', previousData = {}, localData = {} } = {}) {
  const normalizedName = normalizeForMatch(clientName);
  if (!normalizedName) return false;

  if (sameNormalizedText(previousData.clientName, normalizedName)) return true;
  if (sameNormalizedText(localData.clientName, normalizedName)) return true;

  const explicitName = extractName(currentText);
  if (sameNormalizedText(explicitName, normalizedName)) return true;

  const standaloneName = extractStandaloneNameAnswer(currentText);
  if (sameNormalizedText(standaloneName, normalizedName)) return true;

  const sourceText = [
    currentText,
    ...(Array.isArray(previousData.recentMessages)
      ? previousData.recentMessages
        .filter((message) => message && message.role === 'cliente')
        .map((message) => message.text)
      : [])
  ].join('\n');

  return normalizedNameAppearsInText(normalizedName, sourceText);
}

function sameNormalizedText(value, normalizedText) {
  return Boolean(value && normalizeForMatch(value) === normalizedText);
}

function normalizedNameAppearsInText(normalizedName, sourceText) {
  const normalizedSource = normalizeForMatch(sourceText);
  if (!normalizedName || !normalizedSource) return false;

  const words = normalizedName.split(' ').filter((word) => word.length >= 2);
  if (!words.length) return false;
  if (words.some((word) => NON_NAME_WORDS.has(word) || NON_NAME_EXACT_PHRASES.has(word))) return false;

  return words.every((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`).test(normalizedSource));
}

function normalizeAssistantVisitDate(value, { receivedAt = new Date(), timezone = 'America/Sao_Paulo' } = {}) {
  const text = String(value || '').trim();
  if (!text) return {};

  const today = getDateKeyInTimezone(receivedAt, timezone);
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    const visitDate = buildDateInSameMonth(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

    if (!visitDate) {
      return { visitDateError: 'Essa data não parece existir.' };
    }

    const validation = validateVisitDate(visitDate, formatDateBr(visitDate), today);
    return validation.ok
      ? { visitDate: validation.visitDate }
      : { visitDateError: validation.reason };
  }

  const parsed = parseVisitDay(text, {
    receivedAt,
    timezone,
    allowLooseDay: true
  });

  if (parsed.ok) return { visitDate: parsed.visitDate };
  if (parsed.matched) return { visitDateError: parsed.reason };

  return {};
}

function normalizeVisitTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const matchable = normalizeForMatch(text);
  if (/\ba combinar\b|\bsem preferencia\b|\bqualquer horario\b/.test(matchable)) return 'A combinar';
  if (/\bmanha\b/.test(matchable)) return 'Manhã';
  if (/\btarde\b/.test(matchable)) return 'Tarde';
  if (/\bnoite\b/.test(matchable)) return 'Noite';

  const time = matchable.match(/\b([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)?\b/);
  if (time) {
    const hour = String(Number(time[1])).padStart(2, '0');
    const minute = String(time[2] || '00').padStart(2, '0');
    return `${hour}:${minute}`;
  }

  return text.replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeAddress(value) {
  return String(value || '')
    .trim()
    .replace(/^(?:endereco|endereço|local|obra)\s*[:,-]?\s+/i, '')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

function normalizeNotes(value) {
  return String(value || '')
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 600);
}

function isAssistantVisitComplete(data = {}) {
  return Boolean(
    data.clientName
    && data.visitDate
    && data.visitTime
    && (data.address || data.neighborhood)
  );
}

function buildAssistantFollowUpReply(reply, data = {}) {
  if (data.visitDateError) {
    return [
      data.visitDateError,
      '',
      getNextMissingSchedulingQuestion(data)
    ].join('\n');
  }

  if (!isAssistantVisitComplete(data)) {
    return getNextMissingSchedulingQuestion(data);
  }

  const text = String(reply || '').trim();
  return text || getNextMissingSchedulingQuestion(data);
}

function getNextMissingSchedulingQuestion(data = {}) {
  if (!data.clientName) return getNamePrompt(data.namePromptCount || 1);
  if (!data.address && !data.neighborhood) return 'Qual é o endereço, bairro ou região da obra?';
  if (!data.visitDate || !data.visitTime) return getDateTimePrompt(data);
  return 'Pode me enviar mais algum detalhe da obra ou observação importante para a equipe?';
}

function getDateTimePrompt(data = {}) {
  const greeting = data.clientName ? `Obrigado, ${data.clientName}.` : 'Obrigado.';

  if (!data.visitDate && !data.visitTime) {
    return [
      greeting,
      'Para agendar a visita técnica, informe:',
      '',
      '*DIA:*',
      '*HORÁRIO/PERÍODO:*'
    ].join('\n');
  }

  if (!data.visitDate) {
    return `${greeting} Qual *DIA* você prefere para a visita técnica?`;
  }

  return 'Qual *HORÁRIO/PERÍODO* você prefere para a visita? Se não tiver preferência, posso deixar a combinar.';
}

function incrementNamePromptCount(data = {}) {
  return {
    ...data,
    namePromptCount: parseNonNegativeInteger(data.namePromptCount, 0) + 1
  };
}

function shouldPauseForMissingName(data = {}) {
  return parseNonNegativeInteger(data.namePromptCount, 0) > MAX_NAME_PROMPTS;
}

function getNamePrompt(promptCount = 1) {
  const count = parseNonNegativeInteger(promptCount, 1);

  if (count <= 1) {
    return [
      'Para continuar, envie em uma mensagem separada:',
      '',
      '*NOME:*',
      '*BAIRRO:*'
    ].join('\n');
  }

  if (count === 2) {
    return [
      'Não consegui identificar os dados com segurança. Pode enviar somente:',
      '',
      '*NOME:* João Silva',
      '*BAIRRO:* Campo Grande'
    ].join('\n');
  }

  if (count === 3) {
    return [
      'Ainda preciso confirmar os dados para registrar a visita.',
      '',
      '*NOME:*',
      '*BAIRRO:*'
    ].join('\n');
  }

  return 'Não consegui identificar seu nome com segurança e vou deixar um funcionário da Forte Lajes continuar por aqui para evitar mensagens repetidas.';
}

function appendRecentMessages(existingMessages, customerMessage, assistantReply) {
  const recent = Array.isArray(existingMessages) ? existingMessages.slice(-6) : [];
  recent.push(
    { role: 'cliente', text: truncateConversationText(customerMessage) },
    { role: 'assistente', text: truncateConversationText(assistantReply) }
  );
  return recent.slice(-8);
}

function truncateConversationText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function addInitialWelcomeIfNeeded(reply, shouldAddWelcome) {
  const text = String(reply || '').trim();
  if (!shouldAddWelcome) return text;
  return [WELCOME_MESSAGE, '', text].filter(Boolean).join('\n');
}

function extractSchedulingData(text, { receivedAt, timezone, allowLooseDay = true, expectedStep } = {}) {
  const lines = splitMessageLines(text);
  const data = {};

  for (const line of lines) {
    const visitTime = extractVisitTime(line);
    if (visitTime && !data.visitTime) {
      data.visitTime = visitTime;
    }

    const parsedDay = parseVisitDay(line, {
      receivedAt,
      timezone,
      allowLooseDay
    });

    if (parsedDay.ok && !data.visitDate) {
      data.visitDate = parsedDay.visitDate;
      data.visitDateLabel = parsedDay.label;
    }

    if (parsedDay.matched && parsedDay.reason && !data.visitDateError) {
      data.visitDateError = parsedDay.reason;
    }

    const neighborhood = extractNeighborhood(line);
    if (neighborhood && !data.neighborhood) {
      data.neighborhood = neighborhood;
    }

    const explicitName = extractName(line);
    if (explicitName && !data.clientName) {
      data.clientName = explicitName;
    }
  }

  if (!data.clientName && expectedStep === STEPS.NAME) {
    const candidate = firstUsefulLine(lines, (line) => {
      if (hasSchedulingIntent(line)) return false;
      if (extractNeighborhood(line)) return false;
      const parsedDay = parseVisitDay(line, { receivedAt, timezone, allowLooseDay: true });
      return !parsedDay.ok && !parsedDay.matched;
    });

    if (candidate) {
      const name = extractStandaloneNameAnswer(candidate);
      if (name) data.clientName = name;
    }
  }

  if (!data.neighborhood && expectedStep === STEPS.NEIGHBORHOOD) {
    const candidate = firstUsefulLine(lines, (line) => {
      if (hasSchedulingIntent(line)) return false;
      if (extractName(line)) return false;
      const parsedDay = parseVisitDay(line, { receivedAt, timezone, allowLooseDay: true });
      return !parsedDay.ok && !parsedDay.matched;
    });

    if (candidate) data.neighborhood = normalizeNeighborhood(candidate);
  }

  return { data };
}

function splitMessageLines(text) {
  return String(text || '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstUsefulLine(lines, predicate) {
  return lines.find((line) => line && predicate(line));
}

function extractName(line) {
  const normalized = String(line || '').trim();
  const embeddedName = extractNameByNormalizedMarker(normalized);
  if (embeddedName) return embeddedName;

  const patterns = [
    /^(?:me\s+chamo|meu\s+nome\s+(?:é|e)|sou|aqui\s+(?:é|e))\s+(.+)$/i,
    /^(?:o\s+nome\s+(?:é|e)|nome\s+do\s+cliente\s+(?:é|e)|cliente\s+(?:é|e))\s+(.+)$/i,
    /^(?:pode\s+colocar|coloca|coloque|registra|registre|anota|anote)\s+(?:no\s+nome\s+de\s+|como\s+)?(.+)$/i,
    /^nome\s*[:,-]\s*(.+)$/i,
    /\b(?:me\s+chamo|meu\s+nome\s+(?:é|e)|aqui\s+(?:é|e))\s+(.+)$/i,
    /\b(?:o\s+nome\s+(?:é|e)|nome\s+do\s+cliente\s+(?:é|e)|cliente\s+(?:é|e))\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const candidate = removeTrailingKnownInfo(match[1]);
    const name = normalizeName(candidate);
    if (looksLikePersonName(name)) return name;
  }

  return '';
}

function extractNameByNormalizedMarker(line) {
  const matchable = normalizeForMatch(line);
  const patterns = [
    /(?:^|\s)meu nome e\s+(.+)$/,
    /(?:^|\s)me chamo\s+(.+)$/,
    /(?:^|\s)aqui e\s+(.+)$/,
    /(?:^|\s)nome do cliente e\s+(.+)$/,
    /(?:^|\s)cliente e\s+(.+)$/
  ];

  for (const pattern of patterns) {
    const match = matchable.match(pattern);
    if (!match) continue;

    const candidate = trimNameCandidate(match[1]);
    const name = normalizeName(candidate);
    if (looksLikePersonName(name)) return name;
  }

  return '';
}

function trimNameCandidate(text) {
  const value = String(text || '').trim();
  if (!value) return '';

  const cutPatterns = [
    /\s+\b(?:moro|resido|fico|estou)\b\s+(?:aqui\s+)?(?:em|no|na|nos|nas)?\s+/i,
    /\s+\b(?:bairro|regiao|região|local|localidade|zona)\b\s*[:,-]?\s+/i,
    /\s+\b(?:quero|queria|gostaria|preciso|para|pra|agendar|marcar|solicitar)\b\s+/i,
    /\s+\b(?:visita|orcamento|orçamento|laje|medicao|medição)\b/i,
    /\s+\b(?:dia|data|horario|horário|periodo|período)\b\s*[:,-]?\s+/i
  ];

  let cutIndex = value.length;
  for (const pattern of cutPatterns) {
    const match = value.search(pattern);
    if (match >= 0 && match < cutIndex) cutIndex = match;
  }

  return removeTrailingKnownInfo(value.slice(0, cutIndex));
}

function extractStandaloneNameAnswer(line) {
  const candidate = String(line || '').trim();
  if (!candidate) return '';
  if (/[?]/.test(candidate)) return '';
  if (/[,:;]/.test(candidate)) return '';
  if (hasNonNameConversationIntent(candidate)) return '';

  const name = normalizeName(candidate);
  return looksLikePersonName(name) ? name : '';
}

function hasNonNameConversationIntent(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized) return true;
  if (NON_NAME_EXACT_PHRASES.has(normalized)) return true;

  const patterns = [
    /\b(?:nao|não)\s+(?:sei|tenho|entendi|preciso)\b/,
    /\b(?:quero|queria|gostaria|preciso|pode|consegue|saber|valor|preco|orcamento|orçamento|visita|laje|obra|bairro|endereco|endereço|horario|horário|data|dia)\b/,
    /\b(?:bom dia|boa tarde|boa noite|tudo bem)\b/
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function extractNeighborhood(line) {
  const normalized = String(line || '').trim();
  const patterns = [
    /^(?:moro|eu\s+moro|resido|fico|estou)\s+(?:aqui\s+)?(?:em|no|na|nos|nas)?\s*(.+)$/i,
    /^sou\s+(?:de|do|da|dos|das)\s+(.+)$/i,
    /^(?:bairro|região|regiao|local|localidade|zona)\s*[:,-]?\s*(.+)$/i,
    /\b(?:moro|eu\s+moro|resido|fico|estou)\s+(?:aqui\s+)?(?:em|no|na|nos|nas)?\s*(.+)$/i,
    /\b(?:bairro|região|regiao|local|localidade|zona)\s*[:,-]?\s*(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const neighborhood = normalizeNeighborhood(removeTrailingKnownInfo(match[1]));
    if (neighborhood.length >= 2) return neighborhood;
  }

  return '';
}

function extractVisitTime(line) {
  const text = String(line || '').trim();
  const normalized = normalizeForMatch(text);

  if (/\b(?:a combinar|sem preferencia|sem horario|sem horário|qualquer horario|qualquer horário)\b/.test(normalized)) {
    return 'A combinar';
  }

  if (/\b(?:pela|de|no periodo da|no período da)?\s*manha\b/.test(normalized)) return 'Manhã';
  if (/\b(?:pela|de|no periodo da|no período da)?\s*tarde\b/.test(normalized)) return 'Tarde';
  if (/\b(?:pela|de|no periodo da|no período da)?\s*noite\b/.test(normalized)) return 'Noite';

  const time = normalized.match(/\b(?:as|às|a partir das|por volta das)?\s*([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)?\b/);
  if (!time) return '';

  const hour = String(Number(time[1])).padStart(2, '0');
  const minute = String(time[2] || '00').padStart(2, '0');
  return `${hour}:${minute}`;
}

function removeTrailingKnownInfo(text) {
  return String(text || '')
    .replace(/\s+(?:moro|eu moro|resido|fico|estou)\s+(?:aqui\s+)?(?:em|no|na|nos|nas)?\s+.+$/i, '')
    .replace(/\s+(?:bairro|região|regiao|local|localidade|zona)\s*[:,-]?\s+.+$/i, '')
    .replace(/\s+(?:e\s+)?(?:quero|queria|gostaria|preciso|para|pra|agendar|marcar|solicitar)\s+.+$/i, '')
    .replace(/\s+(?:visita|orçamento|orcamento|laje|medição|medicao)\b.+$/i, '')
    .trim();
}

function hasSchedulingIntent(text) {
  const normalized = normalizeForMatch(text);
  const patterns = [
    /\bagend/,
    /\bmarc(?:a|acao|acoes|ado|ada|ando|ar|ou)\b/,
    /\bvisita\b/,
    /\bvisitar\b/,
    /\borcamento\b/,
    /\bmedic(?:ao|oes)?\b/,
    /\bmedir\b/,
    /\bvistoria\b/,
    /\bavaliacao\b/,
    /\btecnico\b/,
    /\blaje\b/,
    /\blajes\b/
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function parseVisitDay(input, { receivedAt = new Date(), timezone = 'America/Sao_Paulo', allowLooseDay = true } = {}) {
  const normalized = normalizeForMatch(input);
  const today = getDateKeyInTimezone(receivedAt, timezone);
  const todayParts = splitDateKey(today);

  if (/\bdepois de amanha\b/.test(normalized)) {
    const visitDate = addDaysToDateKey(today, 2);
    return validateVisitDate(visitDate, 'depois de amanhã', today);
  }

  if (/\bamanha\b/.test(normalized)) {
    const visitDate = addDaysToDateKey(today, 1);
    return validateVisitDate(visitDate, 'amanhã', today);
  }

  if (/\bhoje\b/.test(normalized)) {
    return validateVisitDate(today, 'hoje', today);
  }

  const weekday = parseWeekday(normalized);
  if (weekday !== null) {
    const currentWeekday = dateKeyToUtcDate(today).getUTCDay();
    let daysToAdd = (weekday - currentWeekday + 7) % 7;
    if (daysToAdd === 0) daysToAdd = 7;
    const visitDate = addDaysToDateKey(today, daysToAdd);
    return validateVisitDate(visitDate, WEEKDAY_NAMES[weekday], today);
  }

  const fullDate = normalized.match(/\b([0-3]?\d)[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (fullDate) {
    const day = Number(fullDate[1]);
    const month = Number(fullDate[2]);
    const yearText = fullDate[3];
    const year = yearText
      ? normalizeParsedYear(Number(yearText))
      : todayParts.year;
    const visitDate = buildDateInSameMonth(year, month, day);

    if (!visitDate) {
      return { ok: false, matched: true, reason: 'Essa data não parece existir.' };
    }

    return validateVisitDate(visitDate, `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`, today);
  }

  const explicitDay = normalized.match(/\bdia\s+([0-3]?\d)\b/);
  const paraDay = normalized.match(/\b(?:para|pro|pra|no dia)\s+([0-3]?\d)\b/);
  const looseDay = allowLooseDay ? normalized.match(/^\s*([0-3]?\d)\s*$/) : null;
  const dayMatch = explicitDay || paraDay || looseDay;

  if (dayMatch) {
    const day = Number(dayMatch[1]);
    const visitDate = buildDateInSameMonth(todayParts.year, todayParts.month, day);

    if (!visitDate) {
      return { ok: false, matched: true, reason: 'Esse dia não parece existir neste mês.' };
    }

    if (visitDate < today) {
      return { ok: false, matched: true, reason: 'Esse dia já passou neste mês.' };
    }

    return validateVisitDate(visitDate, `dia ${day}`, today);
  }

  return { ok: false, matched: false, reason: 'Não consegui entender o dia da visita.' };
}

function validateVisitDate(visitDate, label, today) {
  const minimumVisitDate = getMinimumVisitDate(today);

  if (visitDate < today) {
    return {
      ok: false,
      matched: true,
      reason: 'Essa data já passou.'
    };
  }

  if (visitDate < minimumVisitDate) {
    return {
      ok: false,
      matched: true,
      reason: `Para agendar uma visita, precisamos de pelo menos um dia completo de antecedência. As visitas estão disponíveis a partir de ${formatDateBr(minimumVisitDate)}.`
    };
  }

  return {
    ok: true,
    matched: true,
    visitDate,
    label
  };
}

function getMinimumVisitDate(todayDateKey) {
  return addDaysToDateKey(todayDateKey, 2);
}

function normalizeParsedYear(year) {
  if (year < 100) return 2000 + year;
  return year;
}

function parseWeekday(normalized) {
  const weekdays = [
    { day: 1, patterns: [/\bsegunda(?: feira)?\b/] },
    { day: 2, patterns: [/\bterca(?: feira)?\b/] },
    { day: 3, patterns: [/\bquarta(?: feira)?\b/] },
    { day: 4, patterns: [/\bquinta(?: feira)?\b/] },
    { day: 5, patterns: [/\bsexta(?: feira)?\b/] },
    { day: 6, patterns: [/\bsabado\b/] },
    { day: 0, patterns: [/\bdomingo\b/] }
  ];

  const found = weekdays.find((weekday) => weekday.patterns.some((pattern) => pattern.test(normalized)));
  return found ? found.day : null;
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s/.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSchedulingData(data = {}) {
  const normalized = { ...data };

  if (normalized.clientName) {
    const clientName = normalizeName(normalized.clientName);
    if (looksLikePersonName(clientName)) {
      normalized.clientName = clientName;
    } else {
      delete normalized.clientName;
    }
  }

  if (normalized.neighborhood) {
    normalized.neighborhood = normalizeNeighborhood(normalized.neighborhood);
  }

  if (normalized.visitTime) {
    normalized.visitTime = normalizeVisitTime(normalized.visitTime);
    if (!normalized.visitTime) delete normalized.visitTime;
  }

  return normalized;
}

function normalizeName(text) {
  return String(text || '')
    .trim()
    .replace(/[^\p{Letter}\s'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => part.replace(/^[.'-]+|[.'-]+$/g, ''))
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase('pt-BR') + part.slice(1).toLocaleLowerCase('pt-BR'))
    .join(' ');
}

function normalizeNeighborhood(text) {
  const normalized = String(text || '')
    .trim()
    .replace(/^(?:bairro|regiao|região|zona)\s*[:,-]?\s+/i, (match) => {
      if (/^zona/i.test(match)) return 'Zona ';
      return '';
    })
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part, index) => {
      const lower = part.toLocaleLowerCase('pt-BR');
      if (index > 0 && ['da', 'de', 'do', 'das', 'dos'].includes(lower)) return lower;
      return part.charAt(0).toLocaleUpperCase('pt-BR') + part.slice(1).toLocaleLowerCase('pt-BR');
    })
    .join(' ');

  const corrected = correctKnownNeighborhood(normalized);
  return corrected || normalized;
}

function correctKnownNeighborhood(value) {
  const matchable = normalizeForMatch(value).replace(/\s+/g, ' ').trim();
  if (!matchable) return '';

  const compact = matchable.replace(/\s+/g, '');
  const alias = KNOWN_RIO_NEIGHBORHOOD_ALIASES.get(matchable)
    || KNOWN_RIO_NEIGHBORHOOD_ALIASES.get(compact);
  if (alias) return alias;

  const exact = KNOWN_RIO_NEIGHBORHOOD_MATCHES.find((candidate) => (
    candidate.normalized === matchable || candidate.compact === compact
  ));
  if (exact) return exact.label;

  return findClosestKnownNeighborhood(matchable, compact);
}

function findClosestKnownNeighborhood(matchable, compact) {
  if (compact.length < 5) return '';

  let best = { label: '', score: 0 };
  let secondBest = { label: '', score: 0 };

  for (const candidate of KNOWN_RIO_NEIGHBORHOOD_MATCHES) {
    const score = Math.max(
      stringSimilarity(matchable, candidate.normalized),
      stringSimilarity(compact, candidate.compact)
    );

    if (score > best.score) {
      secondBest = best;
      best = { label: candidate.label, score };
    } else if (score > secondBest.score) {
      secondBest = { label: candidate.label, score };
    }
  }

  const threshold = compact.length <= 7 ? 0.88 : 0.8;
  const clearWinner = best.score - secondBest.score >= 0.05;

  return best.score >= threshold && clearWinner ? best.label : '';
}

function stringSimilarity(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshteinDistance(a, b);
  return 1 - (distance / Math.max(a.length, b.length));
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function looksLikePersonName(text) {
  const raw = String(text || '').trim();
  const normalized = normalizeName(raw);
  const matchable = normalizeForMatch(normalized);
  const words = matchable.split(' ').filter(Boolean);

  if (normalized.length < 2) return false;
  if (normalized.length > MAX_NAME_CHARS) return false;
  if (!words.length || words.length > MAX_NAME_WORDS) return false;
  if (/[0-9@/\\]|https?:|www\./i.test(raw)) return false;
  if (!/^[\p{Letter}\s'.-]+$/u.test(normalized)) return false;
  if (hasSchedulingIntent(normalized)) return false;
  if (extractNeighborhood(normalized)) return false;
  if (parseVisitDay(normalized, { allowLooseDay: true }).matched) return false;
  if (NON_NAME_EXACT_PHRASES.has(matchable)) return false;
  if (words.every((word) => NAME_CONNECTORS.has(word))) return false;
  if (words.some((word) => NON_NAME_WORDS.has(word))) return false;
  return /\p{Letter}{2,}/u.test(normalized);
}

function resolveClientPhone({ from, customerPhone }) {
  const realPhone = extractBrazilianPhoneDigits(customerPhone);
  if (realPhone) return realPhone;

  if (String(from || '').endsWith('@c.us')) {
    return extractBrazilianPhoneDigits(from);
  }

  return '';
}

function resolveSessionKey(from) {
  return `chat:${String(from || 'unknown')}`;
}

function withResolvedPhone(data, resolvedClientPhone) {
  if (!resolvedClientPhone || data.clientPhone) return data;
  return {
    ...data,
    clientPhone: resolvedClientPhone
  };
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

function isCancelIntent(text) {
  return ['cancelar', 'cancela', 'sair', 'parar'].includes(normalizeForMatch(text));
}

function splitDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day };
}

function buildDateInSameMonth(year, month, day) {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function dateKeyToUtcDate(dateKey) {
  const { year, month, day } = splitDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateBr(dateKey) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WEEKDAY_NAMES = {
  0: 'domingo',
  1: 'segunda-feira',
  2: 'terça-feira',
  3: 'quarta-feira',
  4: 'quinta-feira',
  5: 'sexta-feira',
  6: 'sábado'
};

module.exports = {
  SessionManager,
  AVAILABILITY_MESSAGE,
  FACTORY_VIDEO_SENT_EVENT,
  WELCOME_MESSAGE,
  hasSchedulingIntent,
  parseVisitDay
};
