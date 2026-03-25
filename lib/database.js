const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function createDatabase(databasePath) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      project_type TEXT NOT NULL,
      timeline TEXT NOT NULL,
      budget_range TEXT NOT NULL,
      message TEXT NOT NULL,
      wants_demo INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      admin_notes TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  const insertSubmission = db.prepare(`
    INSERT INTO submissions (
      name,
      email,
      company,
      project_type,
      timeline,
      budget_range,
      message,
      wants_demo,
      ip_address,
      user_agent,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectSubmissionById = db.prepare(`
    SELECT
      id,
      name,
      email,
      company,
      project_type AS projectType,
      timeline,
      budget_range AS budgetRange,
      message,
      wants_demo AS wantsDemo,
      status,
      admin_notes AS adminNotes,
      ip_address AS ipAddress,
      user_agent AS userAgent,
      created_at AS createdAt
    FROM submissions
    WHERE id = ?
  `);

  const listSubmissionsStatement = db.prepare(`
    SELECT
      id,
      name,
      email,
      company,
      project_type AS projectType,
      timeline,
      budget_range AS budgetRange,
      message,
      wants_demo AS wantsDemo,
      status,
      admin_notes AS adminNotes,
      ip_address AS ipAddress,
      user_agent AS userAgent,
      created_at AS createdAt
    FROM submissions
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `);

  const updateSubmissionStatement = db.prepare(`
    UPDATE submissions
    SET
      status = ?,
      admin_notes = ?
    WHERE id = ?
  `);

  const publicMetricsStatement = db.prepare(`
    SELECT
      COUNT(*) AS totalSubmissions,
      MAX(created_at) AS lastSubmissionAt
    FROM submissions
  `);

  const statusBreakdownStatement = db.prepare(`
    SELECT
      status,
      COUNT(*) AS count
    FROM submissions
    GROUP BY status
  `);

  const submissionsTodayStatement = db.prepare(`
    SELECT
      COUNT(*) AS count
    FROM submissions
    WHERE created_at >= ?
  `);

  return {
    createSubmission(submission, metadata) {
      const createdAt = new Date().toISOString();
      const result = insertSubmission.run(
        submission.name,
        submission.email,
        submission.company,
        submission.projectType,
        submission.timeline,
        submission.budgetRange,
        submission.message,
        submission.wantsDemo ? 1 : 0,
        metadata.ipAddress,
        metadata.userAgent,
        createdAt,
      );

      return normalizeSubmission(selectSubmissionById.get(Number(result.lastInsertRowid)));
    },

    getPublicMetrics() {
      const row = publicMetricsStatement.get();

      return {
        totalSubmissions: row.totalSubmissions,
        lastSubmissionAt: row.lastSubmissionAt,
      };
    },

    getAdminOverview(liveState, securityFlags) {
      const publicMetrics = publicMetricsStatement.get();
      const breakdown = {
        new: 0,
        reviewing: 0,
        contacted: 0,
        closed: 0,
      };

      for (const row of statusBreakdownStatement.all()) {
        breakdown[row.status] = row.count;
      }

      const todayFloor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const submissionsToday = submissionsTodayStatement.get(todayFloor).count;

      return {
        live: { ...liveState },
        leads: {
          totalSubmissions: publicMetrics.totalSubmissions,
          lastSubmissionAt: publicMetrics.lastSubmissionAt,
          submissionsToday,
          byStatus: breakdown,
        },
        security: securityFlags,
      };
    },

    listSubmissions(limit = 100) {
      return listSubmissionsStatement
        .all(limit)
        .map((submission) => normalizeSubmission(submission));
    },

    updateSubmission(id, update) {
      const result = updateSubmissionStatement.run(update.status, update.adminNotes, id);

      if (!result.changes) {
        return null;
      }

      return normalizeSubmission(selectSubmissionById.get(id));
    },
  };
}

function normalizeSubmission(submission) {
  if (!submission) {
    return null;
  }

  return {
    ...submission,
    wantsDemo: Boolean(submission.wantsDemo),
  };
}

module.exports = {
  createDatabase,
};
