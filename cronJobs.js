const cron = require('node-cron');
const logger = require('./logger');
const {
  addDaysToDateKey,
  cronTimeToMinutes,
  formatBrazilianPhoneNumber,
  getDateKeyInTimezone,
  getLocalMinutesInTimezone,
  parseDailyCronTime
} = require('./utils');

function startCronJobs({ client, database, adminChatId, getAdminChatId, sendAdminMessage, timezone, schedules, enableRecovery = true }) {
  const tasks = [];
  const adminSender = sendAdminMessage || ((message) => client.sendMessage(adminChatId, message));
  const adminChatIdGetter = getAdminChatId || (() => adminChatId);

  scheduleReminder({
    tasks,
    client,
    database,
    adminChatId,
    getAdminChatId: adminChatIdGetter,
    sendAdminMessage: adminSender,
    timezone,
    taskType: 'morning',
    cronExpression: schedules.morning,
    title: 'Checklist de visitas de hoje'
  });

  scheduleReminder({
    tasks,
    client,
    database,
    adminChatId,
    getAdminChatId: adminChatIdGetter,
    sendAdminMessage: adminSender,
    timezone,
    taskType: 'night',
    cronExpression: schedules.night,
    title: 'Roteiro de visitas de amanhã'
  });

  if (enableRecovery) {
    const recoveryTask = cron.schedule(schedules.recovery, async () => {
      await recoverMissedRuns({ client, database, adminChatId, getAdminChatId: adminChatIdGetter, sendAdminMessage: adminSender, timezone, schedules });
    }, {
      name: 'missed-run-recovery',
      timezone,
      noOverlap: true
    });

    tasks.push(recoveryTask);
    setTimeout(() => recoverMissedRuns({ client, database, adminChatId, getAdminChatId: adminChatIdGetter, sendAdminMessage: adminSender, timezone, schedules }), 3000);
  }

  logger.info('Cron jobs started', { timezone, schedules, enableRecovery });

  return {
    stopAll: () => tasks.forEach((task) => task.stop())
  };
}

function scheduleReminder({ tasks, client, database, adminChatId, getAdminChatId, sendAdminMessage, timezone, taskType, cronExpression, title }) {
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression for ${taskType}: ${cronExpression}`);
  }

  const task = cron.schedule(cronExpression, async () => {
    const runForDate = getDateKeyInTimezone(new Date(), timezone);
    await executeReminder({ client, database, adminChatId, getAdminChatId, sendAdminMessage, timezone, taskType, runForDate, title });
  }, {
    name: `${taskType}-reminder`,
    timezone,
    noOverlap: true
  });

  tasks.push(task);
}

async function recoverMissedRuns({ client, database, adminChatId, getAdminChatId, sendAdminMessage, timezone, schedules }) {
  const now = new Date();
  const runForDate = getDateKeyInTimezone(now, timezone);
  const localMinutes = getLocalMinutesInTimezone(now, timezone);

  await maybeRecoverOne({
    client,
    database,
    adminChatId,
    getAdminChatId,
    sendAdminMessage,
    timezone,
    taskType: 'morning',
    runForDate,
    title: 'Checklist de visitas de hoje',
    localMinutes,
    cronExpression: schedules.morning
  });

  await maybeRecoverOne({
    client,
    database,
    adminChatId,
    getAdminChatId,
    sendAdminMessage,
    timezone,
    taskType: 'night',
    runForDate,
    title: 'Roteiro de visitas de amanhã',
    localMinutes,
    cronExpression: schedules.night
  });
}

async function maybeRecoverOne(options) {
  const cronTime = parseDailyCronTime(options.cronExpression);

  if (!cronTime) {
    logger.warn('Missed-run recovery skipped for non-daily cron expression', {
      taskType: options.taskType,
      cronExpression: options.cronExpression
    });
    return;
  }

  if (options.localMinutes < cronTimeToMinutes(cronTime)) return;
  await executeReminder(options);
}

async function executeReminder({ client, database, adminChatId, getAdminChatId, sendAdminMessage, timezone, taskType, runForDate, title }) {
  const adminSender = sendAdminMessage || ((message) => client.sendMessage(adminChatId, message));
  const currentAdminChatId = getAdminChatId ? getAdminChatId() : adminChatId;

  if (!currentAdminChatId) {
    logger.warn('Skipping reminder because ADMIN_PHONE_NUMBER is not resolved', { taskType, runForDate });
    return;
  }

  const claim = database.tryStartNotificationRun(taskType, runForDate);
  if (!claim.shouldRun) {
    logger.debug('Reminder run skipped by idempotency guard', { taskType, runForDate, reason: claim.reason });
    return;
  }

  try {
    const targetDate = taskType === 'night'
      ? addDaysToDateKey(runForDate, 1)
      : runForDate;

    const visits = database.listVisitsByDate(targetDate);
    const message = formatReminderMessage({
      title,
      targetDate,
      visits,
      taskType
    });

    await adminSender(message);
    database.markNotificationRunSent(taskType, runForDate);

    logger.info('Reminder sent', {
      taskType,
      runForDate,
      targetDate,
      visitCount: visits.length
    });
  } catch (error) {
    database.markNotificationRunFailed(taskType, runForDate, error);
    logger.error('Reminder failed', { taskType, runForDate, error });
  }
}

function formatReminderMessage({ title, targetDate, visits, taskType }) {
  const dateBr = formatDateBr(targetDate);
  const intro = taskType === 'night'
    ? `Boa noite. ${title} (${dateBr}):`
    : `Bom dia. ${title} (${dateBr}):`;

  if (!visits.length) {
    return `${intro}\n\nNenhuma visita técnica agendada.`;
  }

  const lines = visits.map((visit, index) => [
    `${index + 1}. ${visit.visit_time || 'A combinar'} - ${visit.client_name}`,
    `   Bairro/região: ${visit.neighborhood || visit.address || 'Não informado'}`,
    ...formatVisitAddressLines(visit),
    `   WhatsApp: ${formatBrazilianPhoneNumber(visit.client_phone)}`,
    `   Protocolo: #${visit.id}`,
    ...formatVisitNoteLines(visit)
  ].join('\n'));

  return `${intro}\n\n${lines.join('\n\n')}`;
}

function formatVisitNoteLines(visit) {
  const notes = String(visit && visit.notes ? visit.notes : '').trim();
  return notes ? [`   Observações: ${notes}`] : [];
}

function formatVisitAddressLines(visit) {
  const address = String(visit && visit.address ? visit.address : '').trim();
  const neighborhood = String(visit && visit.neighborhood ? visit.neighborhood : '').trim();

  if (!address || address === neighborhood) return [];
  return [`   Endereço/local: ${address}`];
}

function formatDateBr(dateKey) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

module.exports = {
  executeReminder,
  startCronJobs
};
