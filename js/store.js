// Data storage: everything lives in this browser's localStorage as one JSON document.
// Every record has an id and updatedAt so backups from teammates can be merged safely.

import { withDefaults, averageOf, nextNightDate } from './scoring.js';

const KEY = 'bowlingRecap.db.v1';
export const SCHEMA = 1;
const COLLECTIONS = ['leagues', 'sessions', 'teams', 'bowlers', 'nights'];

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const now = () => new Date().toISOString();

function emptyDb() {
  return { schema: SCHEMA, leagues: [], sessions: [], teams: [], bowlers: [], nights: [], meta: { lastBackup: null } };
}

export let db = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDb();
    const d = JSON.parse(raw);
    for (const c of COLLECTIONS) if (!Array.isArray(d[c])) d[c] = [];
    d.meta = d.meta || { lastBackup: null };
    return d;
  } catch (e) {
    console.error('Could not load data', e);
    return emptyDb();
  }
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function replaceDb(next) {
  db = next;
  save();
}

// ---------- generic record helpers ----------

export function all(coll) {
  return db[coll].filter((r) => !r.deleted);
}
export function get(coll, id) {
  return db[coll].find((r) => r.id === id && !r.deleted) || null;
}
export function put(coll, rec) {
  rec.updatedAt = now();
  if (!rec.id) rec.id = uid();
  const i = db[coll].findIndex((r) => r.id === rec.id);
  if (i >= 0) db[coll][i] = rec;
  else db[coll].push(rec);
  save();
  return rec;
}
export function remove(coll, id) {
  const r = db[coll].find((x) => x.id === id);
  if (r) {
    // Soft delete so the deletion survives a merge with a teammate's backup.
    r.deleted = true;
    r.updatedAt = now();
    save();
  }
}

// ---------- domain helpers ----------

export function bowlerName(id) {
  const b = get('bowlers', id);
  return b ? b.name : '?';
}
export function teamName(id) {
  const t = get('teams', id);
  return t ? t.name : '?';
}

export function findOrCreateBowler(name) {
  const n = name.trim();
  if (!n) return null;
  const ex = all('bowlers').find((b) => b.name.toLowerCase() === n.toLowerCase());
  return ex || put('bowlers', { name: n });
}

export function findOrCreateTeam(leagueId, name) {
  const n = name.trim();
  if (!n) return null;
  const ex = all('teams').find((t) => t.leagueId === leagueId && t.name.toLowerCase() === n.toLowerCase());
  return ex || put('teams', { leagueId, name: n });
}

export function sessionsOf(leagueId) {
  return all('sessions').filter((s) => s.leagueId === leagueId).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}
export function currentSession(leagueId) {
  const s = sessionsOf(leagueId);
  return s[s.length - 1] || null;
}
export function nightsOf(sessionId) {
  return all('nights').filter((n) => n.sessionId === sessionId).sort((a, b) => a.date.localeCompare(b.date));
}
export function nightsOfLeague(leagueId) {
  const ids = new Set(sessionsOf(leagueId).map((s) => s.id));
  return all('nights').filter((n) => ids.has(n.sessionId)).sort((a, b) => a.date.localeCompare(b.date));
}
export function rulesOf(session) {
  return withDefaults(session && session.rules);
}

export function suggestedNextDate(session) {
  const nights = nightsOf(session.id);
  const last = nights[nights.length - 1];
  let d = nextNightDate(last ? last.date : null, session.startDate, session.skipDates || []);
  if (!last && d) {
    // Starting mid-season with no nights recorded yet: jump to the next league night from today.
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    while (d < today) d = nextNightDate(d, null, session.skipDates || []);
  }
  return d;
}

/** Actual (non-blind) games a bowler bowled in a session before a date. */
export function bowlerSessionPins(sessionId, bowlerId, beforeDate) {
  let pins = 0, games = 0;
  for (const n of nightsOf(sessionId)) {
    if (beforeDate && n.date >= beforeDate) continue;
    for (const side of ['us', 'them']) {
      for (const s of n[side].slots) {
        if (s.kind !== 'bowler' || s.bowlerId !== bowlerId) continue;
        for (const g of s.games) {
          if (!g.blind && typeof g.score === 'number') { pins += g.score; games++; }
        }
      }
    }
  }
  return { pins, games };
}

/** Most recent average entered for a bowler anywhere (optionally only within a league). */
export function lastKnownAverage(bowlerId, beforeDate, leagueId) {
  const nights = (leagueId ? nightsOfLeague(leagueId) : all('nights').slice().sort((a, b) => a.date.localeCompare(b.date)))
    .filter((n) => !beforeDate || n.date < beforeDate)
    .reverse();
  for (const n of nights) {
    for (const side of ['us', 'them']) {
      for (const s of n[side].slots) {
        if (s.kind === 'bowler' && s.bowlerId === bowlerId && typeof s.avg === 'number') {
          return { avg: s.avg, established: s.avgEstablished !== false };
        }
      }
    }
  }
  return null;
}

/**
 * Default average for a bowler on a given night.
 * Our team: calculated from this session's games. Opponents: last average we saw.
 */
export function defaultAverage(session, bowlerId, date, isOurTeam) {
  const rules = rulesOf(session);
  const league = get('leagues', session.leagueId);
  const { pins, games } = bowlerSessionPins(session.id, bowlerId, date);
  if (isOurTeam && games > 0) {
    if (rules.avgMode === 'entering' && games < rules.enteringGames) {
      const prev = lastKnownAverage(bowlerId, session.startDate, league && league.id);
      if (prev) return { avg: prev.avg, established: true };
    }
    return { avg: averageOf(pins, games), established: true };
  }
  if (!isOurTeam) {
    const prev = lastKnownAverage(bowlerId, date, league && league.id);
    if (prev) return { avg: prev.avg, established: true };
    return { avg: null, established: false };
  }
  // Our bowler with no games yet this session.
  if (rules.avgMode === 'entering') {
    const prev = lastKnownAverage(bowlerId, session.startDate, league && league.id);
    if (prev) return { avg: prev.avg, established: true };
  }
  return { avg: null, established: false };
}

/** Bowlers who have appeared on a team, most recent lineup first. */
export function knownMembers(teamId) {
  const seen = new Map();
  const nights = all('nights').slice().sort((a, b) => b.date.localeCompare(a.date));
  for (const n of nights) {
    for (const side of ['us', 'them']) {
      if (n[side].teamId !== teamId) continue;
      n[side].slots.forEach((s, i) => {
        if (s.kind === 'bowler' && s.bowlerId && !seen.has(s.bowlerId)) seen.set(s.bowlerId, { lastDate: n.date, pos: i });
      });
    }
  }
  return [...seen.keys()];
}

export function lastLineup(teamId) {
  const nights = all('nights').slice().sort((a, b) => b.date.localeCompare(a.date));
  for (const n of nights) {
    for (const side of ['us', 'them']) {
      if (n[side].teamId === teamId) return n[side].slots.filter((s) => s.kind === 'bowler').map((s) => s.bowlerId);
    }
  }
  return [];
}

export function makeSlot(session, bowlerId, date, isOurTeam) {
  const games = Array.from({ length: session.gamesPerNight }, () => ({ score: null, blind: false }));
  if (!bowlerId) return { kind: 'empty', bowlerId: null, avg: null, avgEstablished: false, hcpOverride: null, games };
  const d = defaultAverage(session, bowlerId, date, isOurTeam);
  return { kind: 'bowler', bowlerId, avg: d.avg, avgEstablished: d.established, hcpOverride: null, games };
}

// ---------- backup, sharing and merge ----------

export function exportData(leagueIds) {
  const out = { app: 'bowling-recap', schema: SCHEMA, exportedAt: now(), scope: leagueIds ? 'leagues' : 'all' };
  if (!leagueIds) {
    for (const c of COLLECTIONS) out[c] = db[c];
    return out;
  }
  const L = new Set(leagueIds);
  out.leagues = db.leagues.filter((l) => L.has(l.id));
  out.sessions = db.sessions.filter((s) => L.has(s.leagueId));
  const S = new Set(out.sessions.map((s) => s.id));
  out.teams = db.teams.filter((t) => L.has(t.leagueId));
  out.nights = db.nights.filter((n) => S.has(n.sessionId));
  const B = new Set();
  for (const s of out.sessions) for (const r of s.roster || []) B.add(r.bowlerId);
  for (const n of out.nights) for (const side of ['us', 'them']) for (const s of n[side].slots) if (s.bowlerId) B.add(s.bowlerId);
  out.bowlers = db.bowlers.filter((b) => B.has(b.id));
  return out;
}

/** Merge a backup into the current data. Newer updatedAt wins per record. Returns counts. */
export function mergeData(incoming) {
  if (!incoming || incoming.app !== 'bowling-recap') throw new Error('This file is not a Bowling Recap backup.');
  if ((incoming.schema || 1) > SCHEMA) throw new Error('This backup is from a newer version of the app. Update the app first.');
  const counts = { added: 0, updated: 0, unchanged: 0 };
  for (const c of COLLECTIONS) {
    for (const rec of incoming[c] || []) {
      const i = db[c].findIndex((r) => r.id === rec.id);
      if (i < 0) { db[c].push(rec); counts.added++; }
      else if ((rec.updatedAt || '') > (db[c][i].updatedAt || '')) { db[c][i] = rec; counts.updated++; }
      else counts.unchanged++;
    }
  }
  save();
  return counts;
}

export function markBackedUp() {
  db.meta.lastBackup = now();
  save();
}

export function resetAll() {
  replaceDb(emptyDb());
}
