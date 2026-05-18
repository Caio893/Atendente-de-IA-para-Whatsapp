const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const logger = require('./logger');

class AppDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'database.sqlite');
    this.db = null;
  }

  init() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_name TEXT,
        client_phone TEXT,
        address TEXT,
        neighborhood TEXT,
        visit_date TEXT,
        visit_time TEXT,
        notes TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_visits_visit_date_time
        ON visits (visit_date, visit_time);

      CREATE TABLE IF NOT EXISTS conversation_sessions (
        client_phone TEXT PRIMARY KEY,
        step TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notification_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL,
        run_for_date TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_message TEXT,
        UNIQUE(task_type, run_for_date)
      );

      CREATE TABLE IF NOT EXISTS contact_automation (
        client_phone TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        reason TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS contact_events (
        client_phone TEXT NOT NULL,
        event_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (client_phone, event_type)
      );
    `);

    this.ensureColumn('visits', 'neighborhood', 'TEXT');
    this.ensureColumn('visits', 'notes', 'TEXT');

    logger.info('Database initialized', { dbPath: this.dbPath });
  }

  close() {
    if (this.db) this.db.close();
  }

  ensureColumn(tableName, columnName, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = columns.some((column) => column.name === columnName);

    if (!exists) {
      this.db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
    }
  }

  createVisit({ clientName, clientPhone, address, neighborhood, visitDate, visitTime }) {
    const statement = this.db.prepare(`
      INSERT INTO visits (client_name, client_phone, address, neighborhood, visit_date, visit_time, status)
      VALUES (@clientName, @clientPhone, @address, @neighborhood, @visitDate, @visitTime, 'pending')
    `);

    const result = statement.run({
      clientName,
      clientPhone,
      address: address || neighborhood || 'A combinar por mensagem',
      neighborhood: neighborhood || address || 'A combinar por mensagem',
      visitDate,
      visitTime: visitTime || 'A combinar'
    });
    return this.getVisitById(result.lastInsertRowid);
  }

  getVisitById(id) {
    return this.db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  }

  listVisitsByDate(dateKey) {
    return this.db.prepare(`
      SELECT *
      FROM visits
      WHERE visit_date = ?
        AND status != 'cancelled'
      ORDER BY visit_time ASC, id ASC
    `).all(dateKey);
  }

  listVisitsBetween(startDateKey, endDateKey) {
    return this.db.prepare(`
      SELECT *
      FROM visits
      WHERE visit_date BETWEEN ? AND ?
        AND status != 'cancelled'
      ORDER BY visit_date ASC, visit_time ASC, id ASC
    `).all(startDateKey, endDateKey);
  }

  findVisitByPhone(clientPhones, currentDateKey) {
    const keys = normalizeKeyList(clientPhones);
    if (!keys.length) return null;

    const placeholders = keys.map(() => '?').join(', ');
    return this.db.prepare(`
      SELECT *
      FROM visits
      WHERE client_phone IN (${placeholders})
        AND status != 'cancelled'
      ORDER BY
        CASE WHEN visit_date >= ? THEN 0 ELSE 1 END ASC,
        CASE WHEN visit_date >= ? THEN visit_date END ASC,
        visit_date DESC,
        id DESC
      LIMIT 1
    `).get(...keys, currentDateKey, currentDateKey);
  }

  updateVisitDate(visitId, visitDate) {
    const result = this.db.prepare(`
      UPDATE visits
      SET visit_date = ?
      WHERE id = ?
    `).run(visitDate, visitId);

    if (!result.changes) return null;
    return this.getVisitById(visitId);
  }

  appendVisitNote(visitId, noteEntry) {
    const visit = this.getVisitById(visitId);
    if (!visit) return null;

    const existingNotes = String(visit.notes || '').trim();
    const updatedNotes = existingNotes
      ? `${existingNotes}\n\n${noteEntry}`
      : noteEntry;

    this.db.prepare(`
      UPDATE visits
      SET notes = ?
      WHERE id = ?
    `).run(updatedNotes, visitId);

    return this.getVisitById(visitId);
  }

  getSession(clientPhone) {
    const row = this.db.prepare(`
      SELECT client_phone, step, data_json, updated_at
      FROM conversation_sessions
      WHERE client_phone = ?
    `).get(clientPhone);

    if (!row) return null;

    return {
      clientPhone: row.client_phone,
      step: row.step,
      data: safeJsonParse(row.data_json),
      updatedAt: row.updated_at
    };
  }

  saveSession(clientPhone, step, data) {
    this.db.prepare(`
      INSERT INTO conversation_sessions (client_phone, step, data_json, updated_at)
      VALUES (@clientPhone, @step, @dataJson, CURRENT_TIMESTAMP)
      ON CONFLICT(client_phone) DO UPDATE SET
        step = excluded.step,
        data_json = excluded.data_json,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      clientPhone,
      step,
      dataJson: JSON.stringify(data || {})
    });
  }

  deleteSession(clientPhone) {
    return this.db.prepare('DELETE FROM conversation_sessions WHERE client_phone = ?').run(clientPhone).changes;
  }

  isAutomationPaused(clientPhone) {
    const row = this.db.prepare(`
      SELECT status
      FROM contact_automation
      WHERE client_phone = ?
    `).get(clientPhone);

    return row && (row.status === 'paused' || row.status === 'ignored');
  }

  isContactIgnored(clientPhone) {
    const row = this.db.prepare(`
      SELECT status
      FROM contact_automation
      WHERE client_phone = ?
    `).get(clientPhone);

    return row && row.status === 'ignored';
  }

  pauseAutomation(clientPhone, reason = 'human_takeover') {
    this.db.prepare(`
      INSERT INTO contact_automation (client_phone, status, reason, updated_at)
      VALUES (@clientPhone, 'paused', @reason, CURRENT_TIMESTAMP)
      ON CONFLICT(client_phone) DO UPDATE SET
        status = 'paused',
        reason = excluded.reason,
        updated_at = CURRENT_TIMESTAMP
    `).run({ clientPhone, reason });
  }

  reactivateAutomation(clientPhone, reason = 'admin_reactivated') {
    this.db.prepare(`
      INSERT INTO contact_automation (client_phone, status, reason, updated_at)
      VALUES (@clientPhone, 'active', @reason, CURRENT_TIMESTAMP)
      ON CONFLICT(client_phone) DO UPDATE SET
        status = 'active',
        reason = excluded.reason,
        updated_at = CURRENT_TIMESTAMP
    `).run({ clientPhone, reason });
  }

  ignoreContact(clientPhone, reason = 'admin_ignored') {
    this.db.prepare(`
      INSERT INTO contact_automation (client_phone, status, reason, updated_at)
      VALUES (@clientPhone, 'ignored', @reason, CURRENT_TIMESTAMP)
      ON CONFLICT(client_phone) DO UPDATE SET
        status = 'ignored',
        reason = excluded.reason,
        updated_at = CURRENT_TIMESTAMP
    `).run({ clientPhone, reason });
  }

  hasContactEvent(clientPhone, eventType) {
    if (!clientPhone || !eventType) return false;

    const row = this.db.prepare(`
      SELECT 1
      FROM contact_events
      WHERE client_phone = ?
        AND event_type = ?
      LIMIT 1
    `).get(clientPhone, eventType);

    return Boolean(row);
  }

  recordContactEvent(clientPhone, eventType) {
    if (!clientPhone || !eventType) return;

    this.db.prepare(`
      INSERT OR IGNORE INTO contact_events (client_phone, event_type)
      VALUES (?, ?)
    `).run(clientPhone, eventType);
  }

  clearContactEvents(clientPhone) {
    if (!clientPhone) return 0;

    return this.db.prepare('DELETE FROM contact_events WHERE client_phone = ?').run(clientPhone).changes;
  }

  deleteAutomationState(clientPhone) {
    if (!clientPhone) return 0;

    return this.db.prepare('DELETE FROM contact_automation WHERE client_phone = ?').run(clientPhone).changes;
  }

  countContactState(clientPhone) {
    if (!clientPhone) {
      return {
        sessions: 0,
        automation: 0,
        contactEvents: 0
      };
    }

    return {
      sessions: this.db.prepare('SELECT COUNT(*) AS count FROM conversation_sessions WHERE client_phone = ?').get(clientPhone).count,
      automation: this.db.prepare('SELECT COUNT(*) AS count FROM contact_automation WHERE client_phone = ?').get(clientPhone).count,
      contactEvents: this.db.prepare('SELECT COUNT(*) AS count FROM contact_events WHERE client_phone = ?').get(clientPhone).count
    };
  }

  resetContactState(clientPhones) {
    const keys = [...new Set((Array.isArray(clientPhones) ? clientPhones : [clientPhones])
      .map((clientPhone) => String(clientPhone || '').trim())
      .filter(Boolean))];

    const reset = this.db.transaction(() => {
      const result = {
        keys,
        deletedSessions: 0,
        deletedAutomationRows: 0,
        deletedContactEvents: 0,
        remainingState: {}
      };

      for (const key of keys) {
        result.deletedSessions += this.deleteSession(key);
        result.deletedAutomationRows += this.deleteAutomationState(key);
        result.deletedContactEvents += this.clearContactEvents(key);
      }

      for (const key of keys) {
        result.remainingState[key] = this.countContactState(key);
      }

      return result;
    });

    return reset();
  }

  tryStartNotificationRun(taskType, runForDate, staleAfterMinutes = 20) {
    const staleCutoffIso = new Date(Date.now() - staleAfterMinutes * 60 * 1000).toISOString();

    const transaction = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT *
        FROM notification_runs
        WHERE task_type = ?
          AND run_for_date = ?
      `).get(taskType, runForDate);

      if (!existing) {
        this.db.prepare(`
          INSERT INTO notification_runs (task_type, run_for_date, status, started_at)
          VALUES (?, ?, 'running', ?)
        `).run(taskType, runForDate, new Date().toISOString());

        return { shouldRun: true, reason: 'created' };
      }

      if (existing.status === 'sent') {
        return { shouldRun: false, reason: 'already_sent' };
      }

      if (existing.status === 'running' && existing.started_at > staleCutoffIso) {
        return { shouldRun: false, reason: 'already_running' };
      }

      this.db.prepare(`
        UPDATE notification_runs
        SET status = 'running',
            started_at = ?,
            finished_at = NULL,
            error_message = NULL
        WHERE task_type = ?
          AND run_for_date = ?
      `).run(new Date().toISOString(), taskType, runForDate);

      return { shouldRun: true, reason: 'retry' };
    });

    return transaction();
  }

  markNotificationRunSent(taskType, runForDate) {
    this.db.prepare(`
      UPDATE notification_runs
      SET status = 'sent',
          finished_at = ?,
          error_message = NULL
      WHERE task_type = ?
        AND run_for_date = ?
    `).run(new Date().toISOString(), taskType, runForDate);
  }

  markNotificationRunFailed(taskType, runForDate, error) {
    this.db.prepare(`
      UPDATE notification_runs
      SET status = 'failed',
          finished_at = ?,
          error_message = ?
      WHERE task_type = ?
        AND run_for_date = ?
    `).run(new Date().toISOString(), String(error && error.message ? error.message : error), taskType, runForDate);
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (error) {
    logger.warn('Invalid session JSON found; starting with empty session data', { error });
    return {};
  }
}

function normalizeKeyList(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

module.exports = {
  AppDatabase
};
