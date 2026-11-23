import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage so store.js can run in Node.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { convertLeaguePals, splitLeagueName, titleCase } = await import('../js/leaguepals.js');
const S = await import('../js/store.js');

// Synthetic data in the shape LeaguePals returns (made-up names and ids).
const OURS = 'team-ours', OPP = 'team-opp', BYE = 'team-bye';
const g = (pins, avg, hcp, extra = {}) => ({ totalPins: pins, average: avg, handicap: hcp, isVacant: false, isBlind: false, isSubstitute: false, ...extra });
const player = (id, name, games) => ({ bowler: id ? { _id: id, name } : null, games });
const vacant = () => player(null, null, [0, 1, 2].map(() => ({ totalPins: 150, isVacant: true, average: 150, handicap: 63 })));

function match(id, date, ourLane, ourPlayers, oppPlayers, pts) {
  const ours = { team: { _id: OURS, name: 'Gutter Kings' }, lane: String(ourLane), players: ourPlayers };
  const opp = { team: { _id: OPP, name: 'Split Happens' }, lane: String(ourLane % 2 ? ourLane + 1 : ourLane - 1), players: oppPlayers };
  return {
    _id: id, date: `${date}T00:00:00.000Z`, gamesPerMatch: 3,
    team1Ref: ours.team, team2Ref: opp.team, team1Score: pts[0], team2Score: pts[1],
    teams: [ours, opp], team1: [], team2: [],
  };
}

const ourLineup = () => [
  player('b1', 'Alex Able', [g(200, 200, 18), g(210, 200, 18), g(190, 200, 18)]),
  player('b2', 'Bo Baker', [g(150, 150, 63), g(160, 150, 63), g(170, 150, 63)]),
];
const raw = {
  kind: 'leaguepals-raw', leagueId: 'lg1', teamId: OURS,
  league: {
    _id: 'lg1', name: 'Thursday Mixed - Spring 27', gamesPerWeek: 3, numPlayers: 2, vacancyScore: 150, time: '7:00 PM',
    handicapRules: { percentage: 90, percentageOf: 220 },
    seasons: [{ dateStart: '2027-01-07T00:00:00.000Z' }],
    teams: [{ _id: OURS, name: 'Gutter Kings' }, { _id: OPP, name: 'Split Happens' }, { _id: BYE, name: 'BYE' }],
  },
  matches: [
    // Week 1, we're on lane 5 (odd). Opponent has a vacant and a bowler.
    match('m1', '2027-01-07', 5, ourLineup(), [
      player('b3', 'Cy Carter', [g(180, 180, 36), g(180, 180, 36), g(180, 180, 36)]),
      vacant(),
    ], [8, 0]),
    // Week 2, we're on lane 8 (even). Bo is out: a sub bowls for him; Cy is blind in game 3.
    match('m2', '2027-01-14', 8, [
      player('b1', 'Alex Able', [g(220, 200, 18), g(220, 200, 18), g(220, 200, 18)]),
      player('b2', 'Bo Baker', [0, 1, 2].map(() => g(140, 140, 72, { isSubstitute: true, subName: 'DANA DRIVER' }))),
    ], [
      player('b3', 'Cy Carter', [g(250, 180, 36), g(250, 180, 36), { ...g(170, 180, 36), isBlind: true }]),
      player('b4', 'Di Dunn', [g(100, 100, 108), g(100, 100, 108), g(100, 100, 108)]),
    ], [2, 6]),
  ],
};

test('league name splits into league and session', () => {
  assert.deepEqual(splitLeagueName('Tuesday PMP - Fall 26'), { league: 'Tuesday PMP', session: 'Fall 26' });
  assert.deepEqual(splitLeagueName('Summer Trios'), { league: 'Summer Trios', session: 'Summer Trios' });
  assert.equal(titleCase('DANA DRIVER'), 'Dana Driver');
  assert.equal(titleCase('McAdams'), 'McAdams');
});

test('converts lineups, vacants, subs, blinds and lanes', () => {
  const b = convertLeaguePals(raw);
  assert.equal(b.leagueName, 'Thursday Mixed');
  assert.equal(b.sessionName, 'Spring 27');
  assert.equal(b.day, 4); // Thursday
  assert.equal(b.startDate, '2027-01-07');
  assert.equal(b.rules.vacantHcp, 63);
  assert.equal(b.teams.length, 2, 'BYE is dropped');
  assert.equal(b.nights.length, 2);

  const [n1, n2] = b.nights;
  assert.equal(n1.ourLane, 'odd');
  assert.deepEqual(n1.lanes, { odd: 5, even: 6 });
  assert.equal(n1.them[1].kind, 'vacant');
  assert.equal(n2.ourLane, 'even');
  assert.deepEqual(n2.lanes, { odd: 7, even: 8 });

  const sub = b.bowlers.find((x) => x.key === n2.us[1].bowlerKey);
  assert.equal(sub.name, 'Dana Driver');
  assert.equal(n2.us[1].avg, 140);
  assert.deepEqual(n2.them[0].games.map((x) => x.blind), [false, false, true]);
});

test('points recalculated here match LeaguePals', () => {
  const b = convertLeaguePals(raw);
  // Night 1: 8-0. Night 2: we win only game 3 (450 vs 414 with the blind), so 2-6.
  for (const c of b.checks) assert.ok(c.ok, `${c.date}: LeaguePals ${c.lp} vs ${c.calc}`);
});

test('import merges into existing league by name and re-import does not duplicate', () => {
  S.resetAll();
  const league = S.put('leagues', { name: 'Thursday Mixed', day: 4, time: '7:00 PM', alley: 'Main St Lanes', travel: false });
  const ours = S.put('teams', { leagueId: league.id, name: 'Gutter Kings', ours: true });
  league.ourTeamId = ours.id;
  S.put('leagues', league);
  S.put('teams', { leagueId: league.id, name: 'Split Happens' });

  const r1 = S.importLeaguePals(convertLeaguePals(raw));
  assert.equal(r1.leagueId, league.id);
  assert.equal(r1.added, 2);
  assert.equal(r1.newTeams, 0, 'existing opponent matched by name');
  assert.equal(S.all('leagues').length, 1);
  assert.equal(S.all('nights').length, 2);
  const session = S.get('sessions', r1.sessionId);
  assert.equal(session.name, 'Spring 27');
  const roster = session.roster.map((x) => [S.bowlerName(x.bowlerId), x.role]);
  assert.deepEqual(roster.sort(), [['Alex Able', 'regular'], ['Bo Baker', 'regular'], ['Dana Driver', 'regular']].sort());

  // Our bowler averages now come from imported nights.
  const alex = S.all('bowlers').find((x) => x.name === 'Alex Able');
  assert.deepEqual(S.bowlerSessionPins(session.id, alex.id), { pins: 1260, games: 6 });

  // Unlock one night (as if corrected in the app), then import again.
  const n1 = S.all('nights').find((n) => n.date === '2027-01-07');
  n1.locked = false;
  S.put('nights', n1);
  const r2 = S.importLeaguePals(convertLeaguePals(raw));
  assert.equal(r2.added, 0);
  assert.equal(r2.updated, 1);
  assert.equal(r2.kept, 1);
  assert.equal(S.all('nights').length, 2);
  assert.equal(S.all('bowlers').length, 5);
});
