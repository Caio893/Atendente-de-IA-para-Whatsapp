function extractDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

function toWhatsAppChatId(value = '') {
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;

  const digits = normalizeBrazilianPhoneDigits(raw);
  return digits ? `${digits}@c.us` : '';
}

function normalizeBrazilianPhoneDigits(value = '') {
  return normalizeBrazilianPhoneNumber(value).normalized;
}

function normalizeBrazilianPhoneNumber(value = '') {
  const original = String(value || '').trim();
  const digits = extractDigits(original);

  if (!digits) {
    return {
      ok: false,
      original,
      digits,
      normalized: '',
      national: '',
      reason: 'missing_digits'
    };
  }

  let national = '';
  if (digits.startsWith('55')) {
    national = digits.slice(2);
  } else if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  if (national.length !== 10 && national.length !== 11) {
    return {
      ok: false,
      original,
      digits,
      normalized: '',
      national,
      reason: 'invalid_length'
    };
  }

  if (!/^[1-9]\d/.test(national.slice(0, 2))) {
    return {
      ok: false,
      original,
      digits,
      normalized: '',
      national,
      reason: 'invalid_ddd'
    };
  }

  return {
    ok: true,
    original,
    digits,
    normalized: `55${national}`,
    national,
    reason: ''
  };
}

function formatBrazilianPhoneNumber(value = '') {
  const digits = extractDigits(value);
  if (!digits) return 'Não identificado';

  const national = digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;

  if (national.length === 11) {
    return `${national.slice(0, 2)}${national.slice(2, 7)}-${national.slice(7)}`;
  }

  if (national.length === 10) {
    return `${national.slice(0, 2)}${national.slice(2, 6)}-${national.slice(6)}`;
  }

  return 'Não identificado';
}

function sameWhatsAppContact(a = '', b = '') {
  const left = normalizeBrazilianPhoneDigits(a);
  const right = normalizeBrazilianPhoneDigits(b);
  return Boolean(left && right && left === right);
}

function getDateKeyInTimezone(date = new Date(), timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function getLocalMinutesInTimezone(date = new Date(), timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(byType.hour) * 60 + Number(byType.minute);
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return utcDate.toISOString().slice(0, 10);
}

function parseDailyCronTime(expression) {
  const parts = String(expression || '').trim().split(/\s+/);
  const normalized = parts.length === 6 ? parts.slice(1) : parts;

  if (normalized.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = normalized;
  const isDaily = dayOfMonth === '*' && month === '*' && dayOfWeek === '*';
  const isNumericTime = /^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour);

  if (!isDaily || !isNumericTime) return null;

  const parsed = {
    hour: Number(hour),
    minute: Number(minute)
  };

  if (parsed.hour > 23 || parsed.minute > 59) return null;
  return parsed;
}

function cronTimeToMinutes(cronTime) {
  return cronTime.hour * 60 + cronTime.minute;
}

module.exports = {
  addDaysToDateKey,
  cronTimeToMinutes,
  extractDigits,
  formatBrazilianPhoneNumber,
  getDateKeyInTimezone,
  getLocalMinutesInTimezone,
  normalizeBrazilianPhoneNumber,
  normalizeBrazilianPhoneDigits,
  parseDailyCronTime,
  sameWhatsAppContact,
  toWhatsAppChatId
};
