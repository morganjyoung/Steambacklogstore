/**
 * Gym log: an Apps Script web app that stores every set as a row in a Google Sheet.
 * Deploy as a web app (Execute as: Me, Who has access: Only myself).
 */

// The "Gym log" sheet. Leave empty to use the sheet this script is attached to.
const SHEET_ID = '123gevb-UCnRcvQy-Gyup0tUJqamRw8FcREteSFEV3r0';

const HEADER = ['Session', 'Date', 'Day', 'Exercise', 'Exercise key', 'Set', 'Weight kg', 'Reps', 'Warm-up', 'Note'];
const SESSION_ID = /^\d{4}-\d{2}-\d{2}-[ABC]$/;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Gym log')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

function sheet_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(HEADER);
  return sh;
}

// Sheets turns "2026-10-06" into a date; read it back as yyyy-MM-dd in the sheet's time zone.
function isoDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** Every session, oldest first, grouped from the one-row-per-set sheet. */
function getSessions() {
  const sh = sheet_();
  const tz = sh.getParent().getSpreadsheetTimeZone();
  const byId = {};
  const order = [];
  const n = sh.getLastRow();
  if (n >= 2) {
    sh.getRange(2, 1, n - 1, HEADER.length).getValues().forEach(function (r) {
      const date = isoDate_(r[1], tz);
      const day = String(r[2]).trim().toUpperCase();
      const key = String(r[4]).trim();
      const w = Number(r[6]);
      const reps = Number(r[7]);
      if (!date || !/^[ABC]$/.test(day) || !key || r[6] === '' || isNaN(w) || !(reps > 0)) return;
      const id = date + '-' + day;
      let s = byId[id];
      if (!s) {
        s = byId[id] = { id: id, date: date, day: day, note: r[9] ? String(r[9]) : null, exercises: [], ex: {} };
        order.push(id);
      }
      let ex = s.ex[key];
      if (!ex) {
        ex = s.ex[key] = { key: key, name: String(r[3] || key), sets: [] };
        s.exercises.push(ex);
      }
      const set = { w: w, r: reps };
      if (r[8] === true || String(r[8]).toUpperCase() === 'TRUE') set.warm = true;
      ex.sets.push(set);
    });
  }
  return {
    sheetUrl: sh.getParent().getUrl(),
    sessions: order.map(function (id) { const s = byId[id]; delete s.ex; return s; })
  };
}

function validate_(id, doc) {
  if (!SESSION_ID.test(id)) throw new Error('That session id isn\'t valid.');
  if (!doc || !Array.isArray(doc.exercises) || !doc.exercises.length) throw new Error('Tick at least one set before saving.');
  const rows = [];
  doc.exercises.forEach(function (ex) {
    if (!ex || !/^[A-Za-z0-9_]{1,40}$/.test(String(ex.key))) throw new Error('An exercise is missing its key.');
    (ex.sets || []).forEach(function (s, i) {
      const w = Number(s.w);
      const r = Number(s.r);
      if (isNaN(w) || w < 0 || w > 1000) throw new Error(ex.name + ': weight must be between 0 and 1000 kg.');
      if (!(r >= 1 && r <= 200 && Math.floor(r) === r)) throw new Error(ex.name + ': reps must be a whole number from 1 to 200.');
      rows.push([id, id.slice(0, 10), id.slice(-1), String(ex.name || ex.key).slice(0, 80), ex.key, i + 1, w, r, !!s.warm,
        doc.note ? String(doc.note).slice(0, 500) : '']);
    });
  });
  if (!rows.length) throw new Error('Tick at least one set before saving.');
  return rows;
}

// Delete every row for a session, bottom-up in contiguous blocks.
function removeRows_(sh, id) {
  const tz = sh.getParent().getSpreadsheetTimeZone();
  const n = sh.getLastRow();
  if (n < 2) return 0;
  const vals = sh.getRange(2, 2, n - 1, 2).getValues();
  let removed = 0;
  let end = -1;
  for (let i = vals.length - 1; i >= -1; i--) {
    const hit = i >= 0 && (isoDate_(vals[i][0], tz) + '-' + String(vals[i][1]).trim().toUpperCase()) === id;
    if (hit && end < 0) end = i;
    if (!hit && end >= 0) {
      sh.deleteRows(i + 3, end - i);
      removed += end - i;
      end = -1;
    }
  }
  return removed;
}

/** Save or replace one session. */
function saveSession(id, doc) {
  const rows = validate_(id, doc);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    removeRows_(sh, id);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  const saved = getSessions().sessions.filter(function (s) { return s.id === id; })[0];
  if (!saved) throw new Error('Saved, but couldn\'t read the session back. Check the sheet.');
  return saved;
}

function deleteSession(id) {
  if (!SESSION_ID.test(id)) throw new Error('That session id isn\'t valid.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!removeRows_(sheet_(), id)) throw new Error('That session isn\'t in the sheet any more.');
  } finally {
    lock.releaseLock();
  }
  return null;
}
