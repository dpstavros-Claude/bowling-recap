import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handicapFor, averageOf, resolveSlot, teamTotals, computeMatch, nextNightDate, totalPointsAvailable,
} from '../js/scoring.js';

const PMP = { hcpPct: 90, hcpBase: 220, vacantScore: 150, vacantHcp: 63, blindPenalty: 10 };
const bowler = (avg, scores, extra = {}) => ({
  kind: 'bowler', avg, avgEstablished: avg != null, games: scores.map((s) => ({ score: s, blind: false })), ...extra,
});

test('handicap is 90% of 220, rounded down, 0 at or above 220', () => {
  assert.equal(handicapFor(200, PMP), 18);
  assert.equal(handicapFor(180, PMP), 36);
  assert.equal(handicapFor(216, PMP), 3); // 3.6 -> 3
  assert.equal(handicapFor(162, PMP), 52); // 52.2 -> 52
  assert.equal(handicapFor(220, PMP), 0);
  assert.equal(handicapFor(235, PMP), 0);
  assert.equal(handicapFor(150, { ...PMP, hcpMax: 50 }), 50);
});

test('USBC average rounds down', () => {
  assert.equal(averageOf(572, 3), 190); // 190.67 -> 190
  assert.equal(averageOf(0, 0), null);
});

test('new bowler average is established during the night (spec example)', () => {
  const s = { kind: 'bowler', avg: null, avgEstablished: false, games: [{ score: 200 }, {}, {}] };
  let r = resolveSlot(s, 3, PMP);
  assert.equal(r.avg, 200);
  assert.equal(r.hcp, 18);
  assert.equal(r.provisional, true);

  s.games[1] = { score: 160 };
  r = resolveSlot(s, 3, PMP);
  assert.equal(r.avg, 180);
  assert.equal(r.hcp, 36);
  assert.equal(r.games[0].hcp, 36, 'earlier games re-use the newest handicap');

  s.games[2] = { score: 210 }; // 570 / 3 = 190
  r = resolveSlot(s, 3, PMP);
  assert.equal(r.avg, 190);
  assert.equal(r.hcp, 27);
  assert.equal(r.provisional, false);
});

test('vacant uses league vacant score and handicap', () => {
  const r = resolveSlot({ kind: 'vacant' }, 3, PMP);
  assert.deepEqual(r.games.map((g) => g.scratch + g.hcp), [213, 213, 213]);
});

test('blind is average minus 10 with normal handicap, per game', () => {
  const s = bowler(180, [190, null, null]);
  s.games[1] = { blind: true };
  s.games[2] = { blind: true };
  const r = resolveSlot(s, 3, PMP);
  assert.deepEqual(r.games.map((g) => g.scratch), [190, 170, 170]);
  assert.deepEqual(r.games.map((g) => g.hcp), [36, 36, 36]);
});

test('real night: Beer Frame vs DeBary Diner, Nov 17 2026, ends 2-6', () => {
  // Beer Frame lineup from LeaguePals (avg, scratch games).
  const beer = [
    bowler(216, [192, 194, 219]),
    bowler(162, [150, 159, 170]),
    bowler(182, [133, 183, 214]),
    bowler(215, [182, 246, 242]),
  ];
  const t = teamTotals(beer, 3, PMP);
  assert.deepEqual(t.games.map((g) => g.total), [750, 875, 938]);
  assert.equal(t.series.total, 2563);
  assert.equal(t.series.scratch, 2284);

  // DeBary's handicap totals were 892, 938, 935: model as one 220 bowler + three zero games.
  const debary = [bowler(220, [892, 938, 935]), bowler(220, [0, 0, 0]), bowler(220, [0, 0, 0]), bowler(220, [0, 0, 0])];
  const m = computeMatch(beer, debary, 3, PMP);
  assert.deepEqual(m.pointsA.games.map((g) => g.pts), [0, 0, 2]);
  assert.deepEqual(m.pointsB.games.map((g) => g.pts), [2, 2, 0]);
  assert.equal(m.pointsA.final, 2);
  assert.equal(m.pointsB.final, 6);
  assert.equal(m.totalPoints, 8);
});

test('ties split points 1 and 1', () => {
  const a = [bowler(220, [200, 200, 200])];
  const b = [bowler(220, [200, 210, 190])];
  const m = computeMatch(a, b, 3, PMP);
  assert.deepEqual(m.pointsA.games.map((g) => g.pts), [1, 0, 2]);
  assert.equal(m.pointsA.series.pts, 1);
  assert.equal(m.pointsA.final, 4);
  assert.equal(m.pointsB.final, 4);
});

test('unfinished games are projected, not final', () => {
  const a = [bowler(200, [250, null, null])];
  const b = [bowler(200, [180, null, null])];
  const m = computeMatch(a, b, 3, PMP);
  assert.equal(m.pointsA.games[0].final, true);
  assert.equal(m.pointsA.games[1].final, false);
  assert.equal(m.pointsA.final, 2, 'only game 1 is official');
  // Games 2-3 project as ties (both 200 averages); series projects to A on the 70-pin lead.
  assert.equal(m.pointsA.projected, 2 + 1 + 1 + 2);
  assert.equal(m.pointsA.series.final, false);
});

test('individual points when the league awards them', () => {
  const rules = { ...PMP, indivGamePts: 1, indivSeriesPts: 1 };
  const a = [bowler(200, [200, 200, 200]), bowler(200, [150, 150, 150])];
  const b = [bowler(200, [190, 190, 190]), bowler(200, [160, 160, 160])];
  const m = computeMatch(a, b, 3, rules);
  assert.equal(m.totalPoints, 8 + 2 * 4);
  assert.equal(m.pointsA.indiv[0].series.pts, 1);
  assert.equal(m.pointsB.indiv[1].series.pts, 1);
  assert.equal(totalPointsAvailable(3, rules, 4), 8 + 16);
});

test('next night is the same weekday next week, skipping holidays', () => {
  assert.equal(nextNightDate('2026-11-17', '2026-10-13'), '2026-11-24');
  assert.equal(nextNightDate('2026-12-15', null, ['2026-12-22', '2026-12-29']), '2027-01-05');
  assert.equal(nextNightDate(null, '2026-10-13'), '2026-10-13');
});
