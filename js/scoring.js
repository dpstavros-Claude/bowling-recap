// Pure scoring functions: handicap, averages, team totals and points.
// No DOM or storage access here, so this file can be unit tested in Node.

export const DEFAULT_RULES = Object.freeze({
  hcpPct: 90,          // handicap percentage
  hcpBase: 220,        // handicap base score
  hcpMax: null,        // optional maximum handicap per game (null = no cap)
  vacantScore: 150,    // scratch score used for a VACANT position
  vacantHcp: 63,       // handicap used for a VACANT position
  blindPenalty: 10,    // pins subtracted from average for a BLIND game
  pointsBasis: 'hcp',  // 'hcp' or 'scratch'
  gamePts: 2,          // points for winning each game (team total)
  gameTiePts: 1,       // points each team gets for a tied game
  seriesPts: 2,        // points for winning the series (team total)
  seriesTiePts: 1,     // points each team gets for a tied series
  indivGamePts: 0,     // points per game for each head-to-head bowler win
  indivGameTiePts: 0,
  indivSeriesPts: 0,   // points for each head-to-head bowler series win
  indivSeriesTiePts: 0,
  avgMode: 'establish', // 'establish' = new average from first night; 'entering' = prior average held for N games
  enteringGames: 9,
});

export function withDefaults(rules) {
  return { ...DEFAULT_RULES, ...(rules || {}) };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** USBC average: total pins / games, rounded down. */
export function averageOf(pins, games) {
  if (!games) return null;
  return Math.floor(pins / games);
}

/** Handicap for one game from an average, rounded down, never below 0. */
export function handicapFor(avg, rules) {
  const r = withDefaults(rules);
  if (!isNum(avg)) return 0;
  // Integer math keeps the rounding exact: (220 - 216) * 90 / 100 = 3.6 -> 3.
  let hcp = Math.floor(((r.hcpBase - avg) * r.hcpPct) / 100);
  if (hcp < 0) hcp = 0;
  if (isNum(r.hcpMax) && hcp > r.hcpMax) hcp = r.hcpMax;
  return hcp;
}

/**
 * Resolve one lineup position for the night.
 * slot = { kind: 'bowler'|'vacant'|'empty', avg, avgEstablished, hcpOverride,
 *          games: [{ score: number|null, blind: boolean }] }
 * Returns per-game scratch/handicap values plus the average used.
 */
export function resolveSlot(slot, gameCount, rules) {
  const r = withDefaults(rules);
  const games = [];
  if (!slot || slot.kind === 'empty') {
    for (let g = 0; g < gameCount; g++) games.push({ scratch: null, hcp: 0, kind: 'empty' });
    return { avg: null, hcp: 0, provisional: false, games, kind: 'empty' };
  }
  if (slot.kind === 'vacant') {
    for (let g = 0; g < gameCount; g++) {
      games.push({ scratch: r.vacantScore, hcp: r.vacantHcp, kind: 'vacant' });
    }
    return { avg: r.vacantScore, hcp: r.vacantHcp, provisional: false, games, kind: 'vacant' };
  }

  const entries = Array.from({ length: gameCount }, (_, g) => (slot.games && slot.games[g]) || {});
  const actual = entries.filter((e) => !e.blind && isNum(e.score)).map((e) => e.score);

  let avg;
  let provisional = false;
  if (slot.avgEstablished && isNum(slot.avg)) {
    avg = slot.avg;
  } else if (actual.length) {
    // Average being established tonight: rolling average of games bowled so far.
    avg = averageOf(actual.reduce((a, b) => a + b, 0), actual.length);
    provisional = actual.length < gameCount;
  } else {
    avg = isNum(slot.avg) ? slot.avg : null;
    provisional = true;
  }

  const hcp = isNum(slot.hcpOverride) ? slot.hcpOverride : handicapFor(avg, r);

  for (const e of entries) {
    if (e.blind) {
      games.push({ scratch: isNum(avg) ? Math.max(0, avg - r.blindPenalty) : null, hcp, kind: 'blind' });
    } else if (isNum(e.score)) {
      games.push({ scratch: e.score, hcp, kind: 'actual' });
    } else {
      games.push({ scratch: null, hcp, kind: 'pending' });
    }
  }
  return { avg, hcp, provisional, games, kind: 'bowler' };
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

/**
 * Totals for one team. Missing scores are projected from the bowler's average
 * (or the vacant score if no average is known) so points can be predicted live.
 */
export function teamTotals(slots, gameCount, rules) {
  const r = withDefaults(rules);
  const resolved = slots.map((s) => resolveSlot(s, gameCount, r));
  const games = [];
  for (let g = 0; g < gameCount; g++) {
    let scratch = 0, hcp = 0, projScratch = 0, complete = true, started = false;
    for (const rs of resolved) {
      const gm = rs.games[g];
      hcp += gm.hcp;
      if (isNum(gm.scratch)) {
        scratch += gm.scratch;
        projScratch += gm.scratch;
        if (gm.kind === 'actual' || gm.kind === 'blind') started = true;
      } else {
        complete = false;
        projScratch += isNum(rs.avg) ? rs.avg : r.vacantScore;
      }
    }
    games.push({
      scratch, hcp, total: scratch + hcp, complete, started,
      projScratch, projTotal: projScratch + hcp,
    });
  }
  const series = {
    scratch: sum(games.map((g) => g.scratch)),
    hcp: sum(games.map((g) => g.hcp)),
    total: sum(games.map((g) => g.total)),
    projTotal: sum(games.map((g) => g.projTotal)),
    projScratch: sum(games.map((g) => g.projScratch)),
    complete: games.every((g) => g.complete),
  };
  const bowlers = resolved.map((rs) => {
    const known = rs.games.filter((g) => isNum(g.scratch));
    const scratch = sum(known.map((g) => g.scratch));
    const hcpPins = sum(rs.games.map((g) => (isNum(g.scratch) ? g.hcp : 0)));
    return { ...rs, seriesScratch: scratch, seriesTotal: scratch + hcpPins, gamesKnown: known.length };
  });
  return { games, series, bowlers };
}

function award(a, b, winPts, tiePts) {
  if (a > b) return [winPts, 0];
  if (b > a) return [0, winPts];
  return [tiePts, tiePts];
}

/**
 * Full match: totals for both sides and points. Points for an unfinished game
 * are "projected" from averages; they become final once every score is in.
 */
export function computeMatch(slotsA, slotsB, gameCount, rules) {
  const r = withDefaults(rules);
  const A = teamTotals(slotsA, gameCount, r);
  const B = teamTotals(slotsB, gameCount, r);
  const val = (g, proj) => {
    if (r.pointsBasis === 'scratch') return proj ? g.projScratch : g.scratch;
    return proj ? g.projTotal : g.total;
  };

  const pointsA = { games: [], series: null, indiv: [], final: 0, projected: 0 };
  const pointsB = { games: [], series: null, indiv: [], final: 0, projected: 0 };

  for (let g = 0; g < gameCount; g++) {
    const ga = A.games[g], gb = B.games[g];
    const final = ga.complete && gb.complete;
    const [pa, pb] = award(val(ga, !final), val(gb, !final), r.gamePts, r.gameTiePts);
    pointsA.games.push({ pts: pa, final });
    pointsB.games.push({ pts: pb, final });
  }
  {
    const final = A.series.complete && B.series.complete;
    const sa = r.pointsBasis === 'scratch' ? (final ? A.series.scratch : A.series.projScratch) : (final ? A.series.total : A.series.projTotal);
    const sb = r.pointsBasis === 'scratch' ? (final ? B.series.scratch : B.series.projScratch) : (final ? B.series.total : B.series.projTotal);
    const [pa, pb] = award(sa, sb, r.seriesPts, r.seriesTiePts);
    pointsA.series = { pts: pa, final };
    pointsB.series = { pts: pb, final };
  }

  // Individual head-to-head points by lineup position.
  if (r.indivGamePts || r.indivSeriesPts) {
    const n = Math.max(slotsA.length, slotsB.length);
    for (let i = 0; i < n; i++) {
      const ba = A.bowlers[i], bb = B.bowlers[i];
      const ia = { games: [], series: null }, ib = { games: [], series: null };
      let ta = 0, tb = 0, allFinal = true;
      for (let g = 0; g < gameCount; g++) {
        const xa = ba ? ba.games[g] : null, xb = bb ? bb.games[g] : null;
        const final = !!(xa && xb && isNum(xa.scratch) && isNum(xb.scratch));
        if (!final) allFinal = false;
        const score = (x, b) => {
          if (!x) return 0;
          const s = isNum(x.scratch) ? x.scratch : (b && isNum(b.avg) ? b.avg : 0);
          return r.pointsBasis === 'scratch' ? s : s + x.hcp;
        };
        const sa = score(xa, ba), sb = score(xb, bb);
        ta += sa; tb += sb;
        const [pa, pb] = r.indivGamePts ? award(sa, sb, r.indivGamePts, r.indivGameTiePts) : [0, 0];
        ia.games.push({ pts: pa, final });
        ib.games.push({ pts: pb, final });
      }
      const [pa, pb] = r.indivSeriesPts ? award(ta, tb, r.indivSeriesPts, r.indivSeriesTiePts) : [0, 0];
      ia.series = { pts: pa, final: allFinal };
      ib.series = { pts: pb, final: allFinal };
      pointsA.indiv.push(ia);
      pointsB.indiv.push(ib);
    }
  }

  for (const [P] of [[pointsA], [pointsB]]) {
    const all = [...P.games, P.series, ...P.indiv.flatMap((x) => [...x.games, x.series])];
    P.final = sum(all.filter((x) => x.final).map((x) => x.pts));
    P.projected = sum(all.map((x) => x.pts));
    P.complete = all.every((x) => x.final);
  }

  return { A, B, pointsA, pointsB, totalPoints: totalPointsAvailable(gameCount, r, Math.max(slotsA.length, slotsB.length)) };
}

export function totalPointsAvailable(gameCount, rules, positions) {
  const r = withDefaults(rules);
  let t = gameCount * r.gamePts + r.seriesPts;
  t += positions * (gameCount * r.indivGamePts + r.indivSeriesPts);
  return t;
}

/** Next league night: 7 days after the last one, skipping listed dates. Dates are 'YYYY-MM-DD'. */
export function nextNightDate(lastDate, startDate, skipDates = []) {
  const skip = new Set(skipDates);
  let d;
  if (lastDate) {
    d = addDays(lastDate, 7);
  } else if (startDate) {
    d = startDate;
  } else {
    return null;
  }
  let guard = 0;
  while (skip.has(d) && guard++ < 60) d = addDays(d, 7);
  return d;
}

export function addDays(ymd, days) {
  const [y, m, dd] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd + days));
  return dt.toISOString().slice(0, 10);
}
