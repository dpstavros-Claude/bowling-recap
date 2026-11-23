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

// ---------- LeaguePals import ----------

const lc = (s) => String(s || '').trim().toLowerCase();

/**
 * Merge a converted LeaguePals bundle (see leaguepals.js) into local data.
 * Re-importing is safe: records are matched by their LeaguePals ids, then by name.
 */
export function importLeaguePals(bundle) {
  const sum = { leagueId: null, sessionId: null, added: 0, updated: 0, kept: 0, newBowlers: 0, newTeams: 0 };

  // League (matched by name) and our team.
  let league = all('leagues').find((l) => (bundle.lpLeagueId && (l.lpLeagueIds || []).includes(bundle.lpLeagueId)))
    || all('leagues').find((l) => lc(l.name) === lc(bundle.leagueName));
  if (!league) {
    league = put('leagues', { name: bundle.leagueName, day: bundle.day ?? 2, time: bundle.time, alley: bundle.alley, travel: false, ourTeamId: null, lpLeagueIds: [] });
  }
  league.lpLeagueIds = [...new Set([...(league.lpLeagueIds || []), bundle.lpLeagueId].filter(Boolean))];
  if (!league.alley && bundle.alley) league.alley = bundle.alley;
  if (!league.time && bundle.time) league.time = bundle.time;
  sum.leagueId = league.id;

  const teamsHere = () => all('teams').filter((t) => t.leagueId === league.id);
  const ourLp = bundle.teams.find((t) => t.lpId === bundle.ourTeamLpId);
  let ours = league.ourTeamId ? get('teams', league.ourTeamId) : null;
  if (!ours) {
    ours = teamsHere().find((t) => t.lpId === bundle.ourTeamLpId) || put('teams', { leagueId: league.id, name: ourLp ? ourLp.name : 'Our team', ours: true });
    league.ourTeamId = ours.id;
  }
  ours.lpId = bundle.ourTeamLpId;
  put('teams', ours);
  put('leagues', league);

  const teamByLp = new Map([[bundle.ourTeamLpId, ours.id]]);
  for (const t of bundle.teams) {
    if (t.lpId === bundle.ourTeamLpId) continue;
    let rec = teamsHere().find((x) => x.lpId === t.lpId) || teamsHere().find((x) => !x.lpId && lc(x.name) === lc(t.name));
    if (!rec) { rec = { leagueId: league.id, name: t.name }; sum.newTeams++; }
    rec.lpId = t.lpId;
    put('teams', rec);
    teamByLp.set(t.lpId, rec.id);
  }

  // Session (one LeaguePals league = one of our sessions).
  let session = all('sessions').find((s) => s.lpLeagueId && s.lpLeagueId === bundle.lpLeagueId)
    || sessionsOf(league.id).find((s) => lc(s.name) === lc(bundle.sessionName));
  if (!session) {
    session = {
      leagueId: league.id, name: bundle.sessionName, startDate: bundle.startDate, weeks: null, skipDates: [],
      gamesPerNight: bundle.gamesPerNight, bowlersPerTeam: bundle.bowlersPerTeam, rosterPolicy: 'subs', roster: [],
      rules: { ...bundle.rules },
    };
  }
  session.lpLeagueId = bundle.lpLeagueId;
  if (!session.startDate) session.startDate = bundle.startDate;
  put('sessions', session);
  sum.sessionId = session.id;

  // Bowlers.
  const bowlerByKey = new Map();
  for (const b of bundle.bowlers) {
    let rec = (b.lpId && all('bowlers').find((x) => x.lpId === b.lpId)) || all('bowlers').find((x) => lc(x.name) === lc(b.name));
    if (!rec) { rec = { name: b.name }; sum.newBowlers++; }
    if (b.lpId) rec.lpId = b.lpId;
    put('bowlers', rec);
    bowlerByKey.set(b.key, rec.id);
  }

  // Nights.
  const usCount = new Map();
  for (const n of bundle.nights) {
    const oppId = teamByLp.get(n.oppLpId);
    const toSlots = (slots) => slots.map(({ bowlerKey, ...s }) => ({ ...s, bowlerId: bowlerKey ? bowlerByKey.get(bowlerKey) || null : null }));
    const us = toSlots(n.us), them = toSlots(n.them);
    for (const s of us) if (s.bowlerId) usCount.set(s.bowlerId, (usCount.get(s.bowlerId) || 0) + 1);

    const existing = all('nights').find((x) => x.lpMatchId === n.lpMatchId);
    const sameNight = !existing && nightsOf(session.id).find((x) => x.date === n.date && x.them.teamId === oppId);
    if (sameNight || (existing && !existing.locked)) { sum.kept++; continue; } // entered or edited in the app: keep yours
    const rec = existing || { sessionId: session.id };
    Object.assign(rec, {
      sessionId: session.id, date: n.date, lanes: n.lanes, ourLane: n.ourLane, locked: true, alley: league.alley,
      lpMatchId: n.lpMatchId, source: 'leaguepals',
      us: { teamId: ours.id, slots: us }, them: { teamId: oppId, slots: them },
    });
    put('nights', rec);
    if (existing) sum.updated++; else sum.added++;
  }

  // Our bowlers join the session roster: regulars bowled at least half the nights.
  const total = bundle.nights.length || 1;
  session.roster = session.roster || [];
  for (const [bid, cnt] of usCount) {
    if (session.roster.some((r) => r.bowlerId === bid)) continue;
    session.roster.push({ bowlerId: bid, role: cnt * 2 >= total ? 'regular' : 'sub' });
  }
  put('sessions', session);
  return sum;
}
