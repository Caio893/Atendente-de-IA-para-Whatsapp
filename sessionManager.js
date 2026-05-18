const { addDaysToDateKey, extractDigits, getDateKeyInTimezone } = require('./utils');

const STEPS = {
  ASSISTANT_OPT_IN: 'assistant_opt_in',
  GREETED: 'greeted',
  NAME: 'name',
  DAY: 'day',
  NEIGHBORHOOD: 'neighborhood',
  FINAL_PENDING: 'final_pending'
};

const VIRTUAL_ASSISTANT_QUESTION = [
  'Olá! Você deseja falar com o atendente virtual da nossa equipe?',
  '',
  'Responda com:',
  'Sim',
  'Não'
].join('\n');

const HUMAN_HANDOFF_MESSAGE = 'Certo. Um funcionário da equipe comercial entrará em contato assim que possível.';
const FACTORY_VIDEO_SENT_EVENT = 'factory_video_sent';

const AVAILABILITY_MESSAGE = [
  'Obrigado por entrar em contato com a nossa equipe.',
  '',
  'No momento não há um funcionário disponível para atender.',
  '',
  'Deixe sua mensagem por aqui que responderemos assim que possível.'
].join('\n');

const WELCOME_MESSAGE = AVAILABILITY_MESSAGE;

class SessionManager {
  constructor(database, options = {}) {
    this.database = database;
    this.timezone = options.timezone || 'America/Sao_Paulo';
    this.cache = new Map();
  }

  handleIncomingMessage({ from, customerPhone, body, receivedAt = new Date(), mediaType = 'text' }) {
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
      this.clearSession(sessionKey);
      return { reply: 'Tudo certo, cancelei este atendimento automático. Se precisar, envie uma nova mensagem para recomeçar.' };
    }

    if (!text) {
      return this.handleEmptyMessage(sessionKey, existingSession, mediaType);
    }

    if (!existingSession) {
      return this.handleFirstMessage(sessionKey, text, receivedAt, resolvedClientPhone);
    }

    if (existingSession.step === STEPS.ASSISTANT_OPT_IN) {
      return this.handleAssistantOptInMessage(sessionKey, existingSession.data, text, receivedAt, resolvedClientPhone);
    }

    if (existingSession.step === STEPS.GREETED) {
      return this.handleGreetedMessage(sessionKey, existingSession.data, text, receivedAt, resolvedClientPhone);
    }

    return this.continueScheduling(sessionKey, existingSession.step, existingSession.data, text, receivedAt, resolvedClientPhone);
  }

  getSession(clientPhone) {
    const cached = this.cache.get(clientPhone);
    if (cached) return cached;

    const persisted = this.database.getSession(clientPhone);
    if (!persisted) return null;

    const session = { step: persisted.step, data: persisted.data || {} };
    this.cache.set(clientPhone, session);
    return session;
  }

  handleFirstMessage(clientPhone, text, receivedAt, resolvedClientPhone = '') {
    this.saveSession(clientPhone, {
      step: STEPS.ASSISTANT_OPT_IN,
      data: {
        firstMessage: text,
        firstReceivedAt: receivedAt.toISOString(),
        clientPhone: resolvedClientPhone || extractBrazilianPhoneDigits(clientPhone)
      }
    });

    return { reply: VIRTUAL_ASSISTANT_QUESTION };
  }

  handleAssistantOptInMessage(clientPhone, currentData, text, receivedAt, resolvedClientPhone = '') {
    const answer = parseAssistantOptInAnswer(text);

    if (!answer) {
      return {
        reply: [
          'Só para eu te direcionar melhor:',
          '',
          VIRTUAL_ASSISTANT_QUESTION
        ].join('\n')
      };
    }

    if (answer === 'no') {
      this.database.pauseAutomation(clientPhone, 'virtual_assistant_declined');
      this.clearSession(clientPhone);
      return { reply: HUMAN_HANDOFF_MESSAGE };
    }

    const firstMessage = currentData.firstMessage || '';
    const firstReceivedAt = currentData.firstReceivedAt ? new Date(currentData.firstReceivedAt) : receivedAt;
    const combinedText = cleanAssistantOptInText([firstMessage, text].filter(Boolean).join('\n'));

    return this.startActivatedBotFlow(clientPhone, combinedText, firstReceivedAt, resolvedClientPhone);
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
      this.saveSession(clientPhone, { step: STEPS.NAME, data });
      return { reply: 'Para solicitar uma visita técnica, por favor me informe seu nome.' };
    }

    if (!data.visitDate) {
      this.saveSession(clientPhone, { step: STEPS.DAY, data });
      return {
        reply: `Obrigado, ${data.clientName}. Qual dia você prefere para a visita?`
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
    const message = mediaType === 'audio'
      ? 'Recebi seu áudio. No momento não consigo ouvir por aqui automaticamente, mas um funcionário da equipe comercial vai escutar e responder assim que possível.'
      : 'Recebi sua mensagem, mas não consegui identificar um texto. Pode enviar por escrito, por favor?';

    if (!existingSession) {
      this.saveSession(clientPhone, { step: STEPS.ASSISTANT_OPT_IN, data: {} });
      return {
        reply: [message, '', VIRTUAL_ASSISTANT_QUESTION].join('\n')
      };
    }

    if (existingSession.step === STEPS.ASSISTANT_OPT_IN) {
      return { reply: [message, '', VIRTUAL_ASSISTANT_QUESTION].join('\n') };
    }

    return { reply: message };
  }

  createVisitRequest(clientPhone, data) {
    const visit = this.database.createVisit({
      clientName: data.clientName,
      clientPhone: data.clientPhone || extractBrazilianPhoneDigits(clientPhone),
      address: data.neighborhood,
      neighborhood: data.neighborhood,
      visitDate: data.visitDate,
      visitTime: 'A combinar'
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
        `Bairro/região: ${visit.neighborhood || visit.address}`,
        '',
        `Protocolo: #${visit.id}`,
        '',
        'Um funcionário da equipe comercial vai continuar o atendimento por mensagem para confirmar o horário e os detalhes.'
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
    this.cache.set(clientPhone, session);
    this.database.saveSession(clientPhone, session.step, session.data);
  }

  clearSession(clientPhone) {
    this.cache.delete(clientPhone);
    this.database.deleteSession(clientPhone);
  }

  clearSessions(clientPhones) {
    for (const clientPhone of clientPhones) {
      this.cache.delete(clientPhone);
    }
  }
}

function extractSchedulingData(text, { receivedAt, timezone, allowLooseDay = true, expectedStep } = {}) {
  const lines = splitMessageLines(text);
  const data = {};

  for (const line of lines) {
    const parsedDay = parseVisitDay(line, {
      receivedAt,
      timezone,
      allowLooseDay
    });

    if (parsedDay.ok && !data.visitDate) {
      data.visitDate = parsedDay.visitDate;
      data.visitDateLabel = parsedDay.label;
      continue;
    }

    if (parsedDay.matched && parsedDay.reason && !data.visitDateError) {
      data.visitDateError = parsedDay.reason;
      continue;
    }

    const neighborhood = extractNeighborhood(line);
    if (neighborhood && !data.neighborhood) {
      data.neighborhood = neighborhood;
      continue;
    }

    const explicitName = extractName(line);
    if (explicitName && !data.clientName) {
      data.clientName = explicitName;
      continue;
    }
  }

  if (!data.clientName && expectedStep === STEPS.NAME) {
    const candidate = firstUsefulLine(lines, (line) => {
      if (hasSchedulingIntent(line)) return false;
      if (extractNeighborhood(line)) return false;
      const parsedDay = parseVisitDay(line, { receivedAt, timezone, allowLooseDay: true });
      return !parsedDay.ok && !parsedDay.matched;
    });

    if (candidate) data.clientName = normalizeName(candidate);
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
  const patterns = [
    /^(?:me\s+chamo|meu\s+nome\s+(?:é|e)|sou|aqui\s+(?:é|e))\s+(.+)$/i,
    /^nome\s*[:,-]\s*(.+)$/i
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

function extractNeighborhood(line) {
  const normalized = String(line || '').trim();
  const patterns = [
    /^(?:moro|eu\s+moro|resido|fico|estou)\s+(?:em|no|na|nos|nas)?\s*(.+)$/i,
    /^sou\s+(?:de|do|da|dos|das)\s+(.+)$/i,
    /^(?:bairro|região|regiao|local|localidade|zona)\s*[:,-]?\s*(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const neighborhood = normalizeNeighborhood(match[1]);
    if (neighborhood.length >= 2) return neighborhood;
  }

  return '';
}

function removeTrailingKnownInfo(text) {
  return String(text || '')
    .replace(/\s+(?:moro|eu moro|resido|fico|estou)\s+(?:em|no|na|nos|nas)?\s+.+$/i, '')
    .replace(/\s+(?:bairro|região|regiao|local|localidade|zona)\s*[:,-]?\s+.+$/i, '')
    .trim();
}

function hasSchedulingIntent(text) {
  const normalized = normalizeForMatch(text);
  const patterns = [
    /\bagend/,
    /\bmarc/,
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

function parseAssistantOptInAnswer(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized) return '';

  const negativePatterns = [
    /^(?:nao|n)\b/,
    /\bnao quero\b/,
    /\bnao preciso\b/,
    /\bsem atendente virtual\b/,
    /\bfalar com (?:um )?(?:humano|funcionario|pessoa|atendente humano)\b/,
    /\bquero (?:um )?(?:humano|funcionario|pessoa|atendente humano)\b/
  ];

  if (negativePatterns.some((pattern) => pattern.test(normalized))) {
    return 'no';
  }

  const positivePatterns = [
    /^(?:sim|s)\b/,
    /\bquero\b/,
    /\bpode ser\b/,
    /\bpode sim\b/,
    /\bfalar com (?:o )?atendente virtual\b/,
    /\batendente virtual\b/,
    /\bassistente virtual\b/
  ];

  if (positivePatterns.some((pattern) => pattern.test(normalized))) {
    return 'yes';
  }

  return '';
}

function cleanAssistantOptInText(text) {
  return splitMessageLines(text)
    .map(stripAssistantOptInPrefix)
    .filter(Boolean)
    .join('\n');
}

function stripAssistantOptInPrefix(line) {
  const original = String(line || '').trim();
  const stripped = original
    .replace(/^\s*(?:sim|s|não|nao|n)\b\s*[,.;:-]?\s*/i, '')
    .replace(/^\s*(?:quero|pode ser|pode sim)\b\s*[,.;:-]?\s*/i, '')
    .replace(/^\s*(?:não quero|nao quero|não preciso|nao preciso)\b\s*[,.;:-]?\s*/i, '')
    .trim();

  if (!stripped && parseAssistantOptInAnswer(original)) return '';
  return stripped;
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

function normalizeName(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => part.charAt(0).toLocaleUpperCase('pt-BR') + part.slice(1).toLocaleLowerCase('pt-BR'))
    .join(' ');
}

function normalizeNeighborhood(text) {
  return String(text || '')
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
}

function looksLikePersonName(text) {
  const normalized = String(text || '').trim();
  if (normalized.length < 2) return false;
  if (hasSchedulingIntent(normalized)) return false;
  if (extractNeighborhood(normalized)) return false;
  if (parseVisitDay(normalized, { allowLooseDay: true }).matched) return false;
  return /[A-Za-zÀ-ÿ]{2,}/.test(normalized);
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
  return ['cancelar', 'cancela', 'sair', 'parar', 'recomeçar', 'recomecar'].includes(normalizeForMatch(text));
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
