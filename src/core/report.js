'use strict';

const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');

// A report is written when one of these parts is stopped: the Congregation Bible Study (midweek)
// or the Watchtower Study (weekend). Concluding Comments deliberately does not trigger one.
const REPORT_AFTER = new Set(['study', 'watchtower']);

/**
 * Over/under report for the parts timed so far. Over/under is measured against the target the clock was
 * counting to (planned time, plus any adjusting or adaptive change), so it reflects what the speaker saw.
 */
function buildReport({ items, meetingType, circuitVisit = false, trigger = null, createdAt }) {
  const parts = items.map((i) => {
    const timed = i.completedSecs != null;
    const target = timed ? (i.completedTargetSecs ?? i.adaptedSecs ?? i.durationSecs) : null;
    return {
      key: i.key,
      name: i.name,
      section: i.sectionTitle,
      plannedSecs: i.originalSecs,
      targetSecs: target,
      actualSecs: timed ? i.completedSecs : null,
      diffSecs: timed ? i.completedSecs - target : null, // + over, - under
    };
  });
  const timed = parts.filter((p) => p.actualSecs != null);
  const sum = (field) => timed.reduce((n, p) => n + p[field], 0);
  return {
    id: reportId(createdAt, meetingType),
    createdAt: createdAt.toISOString(),
    meetingType,
    circuitVisit,
    trigger,
    parts,
    totals: {
      timedParts: timed.length,
      totalParts: parts.length,
      plannedSecs: sum('plannedSecs'),
      targetSecs: sum('targetSecs'),
      actualSecs: sum('actualSecs'),
      diffSecs: sum('diffSecs'),
      overParts: timed.filter((p) => p.diffSecs > 0).length,
      underParts: timed.filter((p) => p.diffSecs < 0).length,
      onTimeParts: timed.filter((p) => p.diffSecs === 0).length,
    },
  };
}

/** Local date and time, so files sort chronologically: 2026-10-28-193005-midweek. */
function reportId(date, meetingType) {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${d}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${meetingType}`;
}

/** "MIDWEEK Time Report 10-27-2026.pdf": meeting type and the local date, month first. */
function pdfName(report) {
  const d = new Date(report.createdAt);
  return `${report.meetingType.toUpperCase()} Time Report ${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}.pdf`;
}

const isReportId = (id) => /^[\w-]{1,60}$/.test(String(id));

/** Reports live as one small JSON file each, in <dataDir>/reports. */
class ReportStore {
  constructor(dir) {
    this.dir = dir;
  }

  save(report) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${report.id}.json`), JSON.stringify(report, null, 2));
  }

  get(id) {
    if (!isReportId(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Newest first. Summaries only. */
  list() {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => this.get(n.slice(0, -5)))
      .filter(Boolean)
      .map(summary)
      .sort((a, b) => (a.id < b.id ? 1 : -1));
  }
}

function summary(r) {
  return { id: r.id, createdAt: r.createdAt, meetingType: r.meetingType, trigger: r.trigger, pdfPath: r.pdfPath || null, diffSecs: r.totals.diffSecs, timedParts: r.totals.timedParts };
}

module.exports = { buildReport, ReportStore, REPORT_AFTER, isReportId, summary, pdfName };
