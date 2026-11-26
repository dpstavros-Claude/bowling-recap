// Turns data exported from leaguepals.com into Bowling Recap records.
// Pure functions only (no DOM, no storage) so they can be unit tested in Node.
//
// Input ("raw" export, made by js/lp-export.js on leaguepals.com):
//   { kind: 'leaguepals-raw', leagueId, teamId, league: <fullLeagueInfoPublic.data>,
//     matches: <recentScoresPublic.data> }
// Output (bundle): plain objects keyed by LeaguePals ids, ready for store.importLeaguePals().

import { computeMatch, handicapFor, withDefaults } from './scoring.js';

export const RAW_KIND = 'leaguepals-raw';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** "Tuesday PMP - Fall 26" -> { league: "Tuesday PMP", session: "Fall 26" } */
export function splitLeagueName(name) {
  const s = String(name || '').trim();
  const m = s.match(/^(.*\S)\s+[-–—]\s+(.+)$/);
  if (m) return { league: m[1].trim(), session: m[2].trim() };
  return { league: s, session: s };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function dayFromName(name, firstDate) {
  const lower = String(name || '').toLowerCase();
  const i = WEEKDAYS.findIndex((d) => lower.includes(d));
  if (i >= 0) return i;
  if (firstDate) {
    const [y, m, d] = firstDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  return null;
}

/** Session rules we can read from LeaguePals. Points rules aren't published, so defaults are used. */
export function rulesFromLeague(league) {
  const hr = (league && league.handicapRules) || {};
  const pct = isNum(hr.percentage) && hr.percentage > 0 ? hr.percentage : 90;
  const base = isNum(hr.percentageOf) && hr.percentageOf > 0 ? hr.percentageOf : 220;
  const vacantScore = isNum(league && league.vacancyScore) ? league.vacancyScore : 150;
  const rules = withDefaults({ hcpPct: pct, hcpBase: base, vacantScore });
  rules.vacantHcp = handicapFor(vacantScore, rules);
  return rules;
}

/**
 * One lineup position from LeaguePals' per-team player entry.
 * Returns a slot plus the bowler key it refers to.
 */
function slotFromPlayer(p, fallback, gameCount, rules) {
  const games = Array.isArray(p && p.games) && p.games.length ? p.games : null;
  const name = p && p.bowler && p.bowler.name;
  const lpId = p && p.bowler && p.bowler._id;

  if (!games) {
    // Older data: only the flat slot arrays. No bowler id means a vacant position.
    if (!fallback || !fallback.bowler) return { slot: vacantSlot(gameCount), bowler: null };
    const hcps = (fallback.gameCalc || []).map((c, i) => c - (fallback.game || [])[i]).filter(isNum);
    const avg = isNum(fallback.average) && fallback.average > 0 ? fallback.average : null;
    return {
      slot: makeSlot(avg, hcps[0], (fallback.game || []).map((s) => ({ score: isNum(s) ? s : null, blind: false })), gameCount, rules),
      bowler: fallback.bowler ? { lpId: fallback.bowler, name: name || null } : null,
    };
  }

  if (games.every((g) => g.isVacant) || (!lpId && !games.some((g) => g.subName))) {
    return { slot: vacantSlot(gameCount), bowler: null };
  }
  const subName = (games.find((g) => g.isSubstitute && g.subName) || {}).subName;
  const g0 = games.find((g) => !g.isVacant) || games[0];
  const avgRaw = isNum(g0.average) ? g0.average : p.average;
  const avg = isNum(avgRaw) && avgRaw > 0 ? avgRaw : null;
  const entries = games.map((g) => (g.isBlind ? { score: null, blind: true } : { score: isNum(g.totalPins) ? g.totalPins : null, blind: false }));
  const bowler = subName
    ? { lpId: null, name: titleCase(subName), sub: true }
    : { lpId, name };
  return { slot: makeSlot(avg, g0.handicap, entries, gameCount, rules), bowler };
}

function makeSlot(avg, lpHcp, entries, gameCount, rules) {
  const games = Array.from({ length: gameCount }, (_, i) => entries[i] || { score: null, blind: false });
  const computed = handicapFor(avg, rules);
  return {
    kind: 'bowler',
    avg,
    avgEstablished: isNum(avg),
    // Keep LeaguePals' handicap only when it differs from what our rules would give.
    hcpOverride: isNum(lpHcp) && (lpHcp !== computed || !isNum(avg)) ? lpHcp : null,
    games,
  };
}

function vacantSlot(gameCount) {
  return {
    kind: 'vacant', bowlerId: null, avg: null, avgEstablished: false, hcpOverride: null,
    games: Array.from({ length: gameCount }, () => ({ score: null, blind: false })),
  };
}

/** "MIKE LEONARD" -> "Mike Leonard"; mixed-case names are left alone. */
export function titleCase(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/**
 * Convert a raw LeaguePals export for one league into a bundle.
 * ourTeamLpId picks whose matches are imported (defaults to raw.teamId).
 */
export function convertLeaguePals(raw, ourTeamLpId) {
  if (!raw || raw.kind !== RAW_KIND) throw new Error('This file is not a LeaguePals export.');
  const league = raw.league || {};
  const teamId = ourTeamLpId || raw.teamId;
  const matches = (raw.matches || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const gameCount = league.gamesPerWeek || (matches[0] && matches[0].gamesPerMatch) || 3;
  const bowlersPerTeam = league.numPlayers || 4;
  const rules = rulesFromLeague(league);
  const names = splitLeagueName(league.name);

  const teams = new Map();
  for (const t of league.teams || []) teams.set(t._id, { lpId: t._id, name: t.name });
  for (const m of matches) {
    for (const t of m.teams || []) if (t.team && t.team._id) teams.set(t.team._id, { lpId: t.team._id, name: t.team.name });
    if (m.team1Ref) teams.set(m.team1Ref._id, { lpId: m.team1Ref._id, name: m.team1Ref.name });
    if (m.team2Ref) teams.set(m.team2Ref._id, { lpId: m.team2Ref._id, name: m.team2Ref.name });
  }
  // A BYE "team" is not an opponent.
  for (const [id, t] of teams) if (/^bye$/i.test(t.name)) teams.delete(id);

  const bowlers = new Map(); // key -> { key, lpId, name }
  const keyFor = (b) => {
    if (!b) return null;
    const key = b.lpId ? `lp:${b.lpId}` : `name:${String(b.name).toLowerCase()}`;
    const prev = bowlers.get(key);
    if (!prev || (!prev.name && b.name)) bowlers.set(key, { key, lpId: b.lpId || null, name: b.name || (prev && prev.name) || 'Unknown bowler' });
    return key;
  };

  // Every team's most recent lineup across the whole league, so a new night against a team
  // we haven't bowled yet can still start with its bowlers and averages filled in.
  const lastAvg = new Map(); // bowler key -> latest average from a night they bowled themselves
  const lineups = new Map(); // team lpId -> { lpId, date, bowlers: [{ key, avg }] }
  for (const m of matches) {
    const date = String(m.date).slice(0, 10);
    for (const t of m.teams || []) {
      const tid = t.team && t.team._id;
      if (!tid || !teams.has(tid)) continue;
      const list = [];
      for (const p of t.players || []) {
        if (!p || !p.bowler || !p.bowler._id) continue;
        const key = keyFor({ lpId: p.bowler._id, name: p.bowler.name });
        const games = Array.isArray(p.games) ? p.games : [];
        const isSub = games.some((g) => g.isSubstitute);
        const g0 = games.find((g) => !g.isVacant) || {};
        const avg = isNum(g0.average) && g0.average > 0 ? g0.average : null;
        if (!isSub && avg) lastAvg.set(key, avg);
        // A sub bowled for this regular: keep the regular in the lineup with their own average.
        list.push({ key, avg: isSub ? null : avg });
      }
      const prev = lineups.get(tid);
      if (list.length && (!prev || prev.date <= date)) lineups.set(tid, { lpId: tid, date, bowlers: list });
    }
  }
  const teamLineups = [...lineups.values()].map((x) => ({
    ...x, bowlers: x.bowlers.map((b) => ({ key: b.key, avg: b.avg || lastAvg.get(b.key) || null })),
  }));

  const nights = [];
  const checks = [];
  for (const m of matches) {
    const sides = (m.teams || []).map((t, ti) => ({ t, flat: ti === 0 ? m.team1 : m.team2 }));
    if (sides.length !== 2) continue;
    const ourIdx = sides.findIndex((s) => s.t.team && s.t.team._id === teamId);
    if (ourIdx < 0) continue;
    const themIdx = 1 - ourIdx;
    const oppId = sides[themIdx].t.team._id;
    if (!teams.has(oppId)) continue; // bye week

    const lineup = (side) => {
      const players = side.t.players || [];
      const flat = side.flat || [];
      const n = Math.max(players.length, flat.length, bowlersPerTeam);
      const slots = [];
      for (let i = 0; i < n && slots.length < Math.max(bowlersPerTeam, players.length); i++) {
        const p = players[i];
        const f = p && p.bowler ? flat.find((x) => x.bowler === p.bowler._id) || flat[i] : flat[i];
        const { slot, bowler } = slotFromPlayer(p, f, gameCount, rules);
        slot.bowlerKey = keyFor(bowler);
        slots.push(slot);
      }
      return slots;
    };
    const us = lineup(sides[ourIdx]);
    const them = lineup(sides[themIdx]);

    const laneA = Number(sides[ourIdx].t.lane), laneB = Number(sides[themIdx].t.lane);
    const odd = isNum(laneA) && isNum(laneB) ? Math.min(laneA, laneB) : null;
    const ourLane = isNum(laneA) && laneA % 2 === 1 ? 'odd' : 'even';
    const date = String(m.date).slice(0, 10);

    const lpUs = ourIdx === 0 ? m.team1Score : m.team2Score;
    const lpThem = ourIdx === 0 ? m.team2Score : m.team1Score;
    const [a, b] = ourLane === 'odd' ? [us, them] : [them, us];
    const res = computeMatch(a, b, gameCount, rules);
    const ours = ourLane === 'odd' ? res.pointsA : res.pointsB;
    const theirs = ourLane === 'odd' ? res.pointsB : res.pointsA;
    checks.push({ date, opponent: teams.get(oppId).name, lp: [lpUs, lpThem], calc: [ours.final, theirs.final], ok: ours.final === lpUs && theirs.final === lpThem });

    nights.push({
      lpMatchId: m._id, date, oppLpId: oppId,
      lanes: { odd, even: isNum(odd) ? odd + 1 : null }, ourLane,
      us: slotsOut(us), them: slotsOut(them),
      lpPoints: [lpUs, lpThem],
    });
  }

  const firstDate = (league.seasons && league.seasons[0] && String(league.seasons[0].dateStart || '').slice(0, 10))
    || String(league.dateStart || '').slice(0, 10) || (nights[0] && nights[0].date) || null;

  return {
    leagueName: names.league,
    sessionName: names.session,
    lpLeagueId: raw.leagueId || league._id,
    ourTeamLpId: teamId,
    day: dayFromName(names.league, firstDate),
    time: league.time || '',
    alley: (league.centerInfo && (league.centerInfo.centerName || league.centerInfo.name)) || raw.centerName || '',
    startDate: firstDate,
    gamesPerNight: gameCount,
    bowlersPerTeam,
    rules,
    teams: [...teams.values()],
    bowlers: [...bowlers.values()],
    nights,
    teamLineups,
    checks,
  };
}

function slotsOut(slots) {
  return slots.map(({ bowlerKey, ...s }) => ({ ...s, bowlerKey: bowlerKey || null }));
}
