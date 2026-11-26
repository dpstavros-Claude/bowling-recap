// Bowling Recap: user interface. Hash routes, plain DOM, no framework.

import { VERSION } from './version.js';
import { computeMatch, handicapFor, DEFAULT_RULES, totalPointsAvailable } from './scoring.js';
import * as S from './store.js';
import { convertLeaguePals, RAW_KIND } from './leaguepals.js';

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $sheet = document.getElementById('sheet');
const $scrim = document.getElementById('scrim');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- small helpers ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fmtDate(ymd, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function setHeader(title, backHash) {
  $title.textContent = title;
  $back.hidden = !backHash;
  $back.dataset.href = backHash || '';
}

// ---------- router ----------

const routes = [
  [/^#?\/?$/, viewHome],
  [/^#\/league\/new$/, () => viewLeagueEdit(null)],
  [/^#\/league\/([^/]+)$/, (id) => viewLeague(id)],
  [/^#\/league\/([^/]+)\/edit$/, (id) => viewLeagueEdit(id)],
  [/^#\/league\/([^/]+)\/session\/new$/, (id) => viewSessionEdit(id, null)],
  [/^#\/session\/([^/]+)\/edit$/, (id) => viewSessionEdit(null, id)],
  [/^#\/session\/([^/]+)\/night\/new$/, (id) => viewNightSetup(id, null)],
  [/^#\/night\/([^/]+)$/, (id) => viewNight(id)],
  [/^#\/night\/([^/]+)\/edit$/, (id) => viewNightSetup(null, id)],
  [/^#\/team\/([^/]+)$/, (id) => viewTeam(id)],
  [/^#\/backup$/, viewBackup],
  [/^#\/import-lp$/, viewImportLp],
];

function render() {
  closeSheet();
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      fn(...m.slice(1));
      window.scrollTo(0, 0);
      return;
    }
  }
  viewHome();
}
window.addEventListener('hashchange', render);
$back.addEventListener('click', () => go($back.dataset.href || '#/'));

// ---------- home ----------

function viewHome() {
  setHeader('Bowling Recap', null);
  const leagues = S.all('leagues').sort((a, b) => a.name.localeCompare(b.name));
  const lastBackup = S.db.meta.lastBackup;
  const needsBackup = S.all('nights').length > 0 && (!lastBackup || Date.now() - Date.parse(lastBackup) > 14 * 864e5);
  $view.innerHTML = `
    ${needsBackup ? `<a class="banner" href="#/backup">No backup in the last 2 weeks. Tap to save one.</a>` : ''}
    <section class="list">
      ${leagues.map((l) => {
        const s = S.currentSession(l.id);
        const nights = s ? S.nightsOf(s.id) : [];
        return `<a class="card" href="#/league/${l.id}">
          <div class="card-title">${esc(l.name)}</div>
          <div class="muted">${esc(DAYS[l.day] || '')} ${esc(l.time || '')} · ${esc(l.travel ? 'Travel league' : l.alley || '')}</div>
          <div class="muted">${s ? `${esc(s.name)} · ${nights.length} night${nights.length === 1 ? '' : 's'}` : 'No session yet'}</div>
        </a>`;
      }).join('')}
    </section>
    ${leagues.length ? '' : `
      <div class="empty">
        <p>No leagues yet.</p>
        <button class="btn primary" data-act="quickstart">Set up Tuesday PMP</button>
        <p class="muted small">Prefilled: Beer Frame at AMF Deltona Lanes, Tue 6:30 PM, Fall 26 session, 90% of 220, 8 points a night, and this season's teams.</p>
      </div>`}
    <div class="actions">
      <a class="btn" href="#/league/new">+ New league</a>
      <a class="btn" href="#/backup">Backup &amp; sharing</a>
    </div>
    <p class="muted small center">Version ${esc(VERSION)}</p>
  `;
}

function quickstartPMP() {
  const league = S.put('leagues', { name: 'Tuesday PMP', day: 2, time: '6:30 PM', alley: 'AMF Deltona Lanes', travel: false, ourTeamId: null });
  const ours = S.put('teams', { leagueId: league.id, name: 'Beer Frame', ours: true });
  league.ourTeamId = ours.id;
  S.put('leagues', league);
  for (const n of ['Pin Pals', 'Gram & The Men', 'DeBary Diner', 'O R E O', 'Stunads', "O'Leary's", 'Ball Busters',
    'Strikingly Average', 'The Next Level', 'Fishwalkers', 'Battle Bus Bowlers', 'The Bowling Stones']) {
    S.put('teams', { leagueId: league.id, name: n });
  }
  S.put('sessions', {
    leagueId: league.id, name: 'Fall 26', startDate: '2026-10-13', weeks: 16, skipDates: [],
    gamesPerNight: 3, bowlersPerTeam: 4, rosterPolicy: 'subs', roster: [],
    rules: { ...DEFAULT_RULES },
  });
  toast('Tuesday PMP is set up. Add your bowlers next.');
  go(`#/session/${S.currentSession(league.id).id}/edit`);
}

// ---------- league ----------

function viewLeague(id) {
  const l = S.get('leagues', id);
  if (!l) return go('#/');
  setHeader(l.name, '#/');
  const sessions = S.sessionsOf(id);
  const sel = viewLeague.sel && sessions.find((s) => s.id === viewLeague.sel) ? viewLeague.sel : sessions.length ? sessions[sessions.length - 1].id : null;
  const s = sel ? S.get('sessions', sel) : null;
  const nights = s ? S.nightsOf(s.id) : [];
  const next = s ? S.suggestedNextDate(s) : null;
  const opponents = S.all('teams').filter((t) => t.leagueId === id && t.id !== l.ourTeamId);
  const h2h = headToHead(id);

  $view.innerHTML = `
    <div class="muted">${esc(DAYS[l.day] || '')} ${esc(l.time || '')} · ${esc(l.travel ? 'Travel league' : l.alley || '')} · ${esc(S.teamName(l.ourTeamId))}</div>
    ${sessions.length > 1 ? `<label class="field"><span>Session</span>
      <select data-change="pickSession">${sessions.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
    ${s ? `
      <a class="btn primary big" href="#/session/${s.id}/night/new">Start night · ${esc(fmtDate(next))}</a>
      <h2>${esc(s.name)} nights</h2>
      <section class="list">
        ${nights.length ? nights.slice().reverse().map((n) => nightRow(n, s)).join('') : '<p class="muted">No nights yet.</p>'}
      </section>
      <div class="actions">
        <a class="btn" href="#/session/${s.id}/edit">Session rules &amp; roster</a>
        <a class="btn" href="#/league/${id}/session/new">+ New session</a>
      </div>` : `
      <div class="empty"><p>This league has no session yet.</p>
      <a class="btn primary" href="#/league/${id}/session/new">+ Add a session</a></div>`}
    <h2>Opponents</h2>
    <section class="list">
      ${opponents.length ? opponents.sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
        const r = h2h.get(t.id);
        return `<a class="row" href="#/team/${t.id}"><span>${esc(t.name)}</span>
          <span class="muted">${r ? `${r.nights} night${r.nights === 1 ? '' : 's'} · ${r.pf}-${r.pa} pts` : 'not faced yet'}</span></a>`;
      }).join('') : '<p class="muted">Teams are added when you start a night.</p>'}
    </section>
    <div class="actions"><a class="btn" href="#/league/${id}/edit">Edit league</a></div>
  `;
}

function nightRow(n, s) {
  const m = matchFor(n, s);
  const us = n.ourLane === 'odd' ? m.pointsA : m.pointsB;
  const them = n.ourLane === 'odd' ? m.pointsB : m.pointsA;
  const pts = us.complete ? `${us.final}-${them.final}` : `${us.final}-${them.final} so far`;
  return `<a class="row" href="#/night/${n.id}">
    <span><b>${esc(fmtDate(n.date))}</b> vs ${esc(S.teamName(n.them.teamId))}</span>
    <span class="muted">Lanes ${esc(n.lanes.odd)}-${esc(n.lanes.even)} · ${pts}${n.locked ? ' · 🔒' : ''}</span></a>`;
}

/** Points for and against each opponent across the whole league. */
function headToHead(leagueId) {
  const out = new Map();
  for (const n of S.nightsOfLeague(leagueId)) {
    const s = S.get('sessions', n.sessionId);
    const m = matchFor(n, s);
    const us = n.ourLane === 'odd' ? m.pointsA : m.pointsB;
    const them = n.ourLane === 'odd' ? m.pointsB : m.pointsA;
    const r = out.get(n.them.teamId) || { nights: 0, pf: 0, pa: 0, w: 0, l: 0, t: 0 };
    r.nights++;
    r.pf += us.final;
    r.pa += them.final;
    if (us.complete) {
      if (us.final > them.final) r.w++;
      else if (us.final < them.final) r.l++;
      else r.t++;
    }
    out.set(n.them.teamId, r);
  }
  return out;
}

function viewLeagueEdit(id) {
  const l = id ? S.get('leagues', id) : { name: '', day: 2, time: '6:30 PM', alley: '', travel: false };
  setHeader(id ? 'Edit league' : 'New league', id ? `#/league/${id}` : '#/');
  $view.innerHTML = `
    <form data-form="league" class="form">
      <label class="field"><span>League name</span><input name="name" required value="${esc(l.name)}" placeholder="Tuesday PMP"></label>
      <label class="field"><span>Our team name</span><input name="ourTeam" required value="${esc(id ? S.teamName(l.ourTeamId) : '')}" placeholder="Beer Frame"></label>
      <div class="two">
        <label class="field"><span>Night</span><select name="day">${DAYS.map((d, i) => `<option value="${i}" ${i === l.day ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="field"><span>Time</span><input name="time" value="${esc(l.time)}"></label>
      </div>
      <label class="field"><span>Bowling alley</span><input name="alley" value="${esc(l.alley)}" placeholder="AMF Deltona Lanes"></label>
      <label class="check"><input type="checkbox" name="travel" ${l.travel ? 'checked' : ''}> Travel league (alley changes each week)</label>
      <button class="btn primary big" type="submit">Save league</button>
      ${id ? `<button class="btn danger" type="button" data-act="deleteLeague" data-id="${id}">Delete league</button>` : ''}
    </form>`;
}

function saveLeague(form, id) {
  const f = new FormData(form);
  const l = id ? S.get('leagues', id) : {};
  l.name = f.get('name').trim();
  l.day = Number(f.get('day'));
  l.time = f.get('time').trim();
  l.alley = f.get('alley').trim();
  l.travel = !!f.get('travel');
  S.put('leagues', l);
  const teamNm = f.get('ourTeam').trim();
  if (l.ourTeamId) {
    const t = S.get('teams', l.ourTeamId);
    t.name = teamNm;
    S.put('teams', t);
  } else {
    const t = S.put('teams', { leagueId: l.id, name: teamNm, ours: true });
    l.ourTeamId = t.id;
    S.put('leagues', l);
  }
  if (!id && !S.currentSession(l.id)) return go(`#/league/${l.id}/session/new`);
  go(`#/league/${l.id}`);
}

// ---------- session (rules + roster) ----------

function viewSessionEdit(leagueId, sessionId) {
  let s;
  if (sessionId) {
    s = S.get('sessions', sessionId);
    if (!s) return go('#/');
    leagueId = s.leagueId;
  } else {
    const prev = S.currentSession(leagueId);
    s = {
      leagueId, name: '', startDate: todayYmd(), weeks: 16, skipDates: [],
      gamesPerNight: prev ? prev.gamesPerNight : 3, bowlersPerTeam: prev ? prev.bowlersPerTeam : 4,
      rosterPolicy: prev ? prev.rosterPolicy : 'subs',
      roster: prev ? prev.roster.map((r) => ({ ...r })) : [],
      rules: prev ? { ...prev.rules } : { ...DEFAULT_RULES },
    };
  }
  const r = S.rulesOf(s);
  setHeader(sessionId ? `${s.name} settings` : 'New session', `#/league/${leagueId}`);
  const roster = s.roster || [];
  const numF = (name, label, val, extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="number" inputmode="numeric" value="${esc(val ?? '')}" ${extra}></label>`;

  $view.innerHTML = `
    <form data-form="session" class="form">
      <h2>Session</h2>
      <label class="field"><span>Session name</span><input name="name" required value="${esc(s.name)}" placeholder="Fall 26"></label>
      <div class="two">
        <label class="field"><span>First night</span><input name="startDate" type="date" value="${esc(s.startDate)}"></label>
        ${numF('weeks', 'Weeks', s.weeks)}
      </div>
      <div class="two">
        ${numF('gamesPerNight', 'Games per night', s.gamesPerNight, 'min="1" max="5"')}
        ${numF('bowlersPerTeam', 'Bowlers per team', s.bowlersPerTeam, 'min="1" max="8"')}
      </div>
      <label class="field"><span>Skipped dates (holidays), one per line</span>
        <textarea name="skipDates" rows="2" placeholder="2026-12-22">${esc((s.skipDates || []).join('\n'))}</textarea></label>

      <h2>Handicap</h2>
      <div class="two">
        ${numF('hcpPct', 'Percent', r.hcpPct)}
        ${numF('hcpBase', 'Of', r.hcpBase)}
      </div>
      ${numF('hcpMax', 'Max handicap per game (blank = none)', r.hcpMax)}
      <label class="field"><span>Averages at the start of the session</span>
        <select name="avgMode">
          <option value="establish" ${r.avgMode === 'establish' ? 'selected' : ''}>Establish a new average on the first night</option>
          <option value="entering" ${r.avgMode === 'entering' ? 'selected' : ''}>Use entering average (last season) for a number of games</option>
        </select></label>
      ${numF('enteringGames', 'Games to hold the entering average', r.enteringGames)}

      <h2>Vacant and blind</h2>
      <div class="two">
        ${numF('vacantScore', 'Vacant score', r.vacantScore)}
        ${numF('vacantHcp', 'Vacant handicap', r.vacantHcp)}
      </div>
      ${numF('blindPenalty', 'Blind: pins below average', r.blindPenalty)}

      <h2>Points</h2>
      <label class="field"><span>Points are decided on</span>
        <select name="pointsBasis">
          <option value="hcp" ${r.pointsBasis === 'hcp' ? 'selected' : ''}>Handicap totals</option>
          <option value="scratch" ${r.pointsBasis === 'scratch' ? 'selected' : ''}>Scratch totals</option>
        </select></label>
      <div class="two">${numF('gamePts', 'Team, each game', r.gamePts)}${numF('gameTiePts', 'Each team on a tie', r.gameTiePts)}</div>
      <div class="two">${numF('seriesPts', 'Team series', r.seriesPts)}${numF('seriesTiePts', 'Each team on a tie', r.seriesTiePts)}</div>
      <div class="two">${numF('indivGamePts', 'Bowler vs bowler, each game', r.indivGamePts)}${numF('indivGameTiePts', 'Each on a tie', r.indivGameTiePts)}</div>
      <div class="two">${numF('indivSeriesPts', 'Bowler vs bowler, series', r.indivSeriesPts)}${numF('indivSeriesTiePts', 'Each on a tie', r.indivSeriesTiePts)}</div>
      <p class="muted small" data-total>Total available: ${totalPointsAvailable(s.gamesPerNight, r, s.bowlersPerTeam)} points a night.</p>

      <h2>Our roster</h2>
      <label class="field"><span>Who can bowl</span>
        <select name="rosterPolicy">
          <option value="subs" ${s.rosterPolicy === 'subs' ? 'selected' : ''}>Roster plus subs</option>
          <option value="fixed" ${s.rosterPolicy === 'fixed' ? 'selected' : ''}>Fixed roster only</option>
        </select></label>
      <div class="roster" data-roster>
        ${roster.map((x, i) => rosterRow(x, i)).join('')}
      </div>
      <div class="inline">
        <input data-new-bowler placeholder="Add bowler name" list="all-bowlers" autocomplete="off">
        <select data-new-role><option value="regular">Regular</option><option value="sub">Sub</option></select>
        <button class="btn" type="button" data-act="addRoster">Add</button>
      </div>
      <datalist id="all-bowlers">${S.all('bowlers').map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
      <p class="muted small">Floating subs can be added from any league: they keep one history across teams.</p>

      <button class="btn primary big" type="submit">Save session</button>
      ${sessionId ? `<button class="btn danger" type="button" data-act="deleteSession" data-id="${sessionId}">Delete session</button>` : ''}
    </form>`;
  viewSessionEdit.draft = s;
}

function rosterRow(x, i) {
  return `<div class="row" data-i="${i}"><span>${esc(S.bowlerName(x.bowlerId))}</span>
    <span><button type="button" class="chip" data-act="toggleRole" data-i="${i}">${x.role === 'sub' ? 'Sub' : 'Regular'}</button>
    <button type="button" class="chip" data-act="rmRoster" data-i="${i}" aria-label="Remove">✕</button></span></div>`;
}

function redrawRoster() {
  const s = viewSessionEdit.draft;
  document.querySelector('[data-roster]').innerHTML = s.roster.map((x, i) => rosterRow(x, i)).join('');
}

function saveSession(form) {
  const s = viewSessionEdit.draft;
  const f = new FormData(form);
  const n = (k) => num(f.get(k));
  s.name = f.get('name').trim();
  s.startDate = f.get('startDate');
  s.weeks = n('weeks');
  s.gamesPerNight = n('gamesPerNight') || 3;
  s.bowlersPerTeam = n('bowlersPerTeam') || 4;
  s.skipDates = f.get('skipDates').split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  s.rosterPolicy = f.get('rosterPolicy');
  s.rules = {
    hcpPct: n('hcpPct') ?? 90, hcpBase: n('hcpBase') ?? 220, hcpMax: n('hcpMax'),
    vacantScore: n('vacantScore') ?? 0, vacantHcp: n('vacantHcp') ?? 0, blindPenalty: n('blindPenalty') ?? 10,
    pointsBasis: f.get('pointsBasis'),
    gamePts: n('gamePts') ?? 0, gameTiePts: n('gameTiePts') ?? 0, seriesPts: n('seriesPts') ?? 0, seriesTiePts: n('seriesTiePts') ?? 0,
    indivGamePts: n('indivGamePts') ?? 0, indivGameTiePts: n('indivGameTiePts') ?? 0,
    indivSeriesPts: n('indivSeriesPts') ?? 0, indivSeriesTiePts: n('indivSeriesTiePts') ?? 0,
    avgMode: f.get('avgMode'), enteringGames: n('enteringGames') ?? 9,
  };
  S.put('sessions', s);
  toast('Session saved');
  go(`#/league/${s.leagueId}`);
}

// ---------- night setup ----------

function viewNightSetup(sessionId, nightId) {
  const night = nightId ? S.get('nights', nightId) : null;
  const s = S.get('sessions', night ? night.sessionId : sessionId);
  if (!s) return go('#/');
  const l = S.get('leagues', s.leagueId);
  setHeader(night ? 'Edit night' : 'Start a night', night ? `#/night/${night.id}` : `#/league/${l.id}`);
  const opponents = S.all('teams').filter((t) => t.leagueId === l.id && t.id !== l.ourTeamId).sort((a, b) => a.name.localeCompare(b.name));
  const date = night ? night.date : S.suggestedNextDate(s) || todayYmd();
  const odd = night ? night.lanes.odd : '';
  $view.innerHTML = `
    <form data-form="night" class="form">
      <label class="field"><span>Date</span><input name="date" type="date" required value="${esc(date)}"></label>
      <div class="two">
        <label class="field"><span>Lane pair (odd lane)</span><input name="odd" type="number" inputmode="numeric" required min="1" step="2" value="${esc(odd)}" placeholder="31"></label>
        <label class="field"><span>We start on</span>
          <select name="ourLane">
            <option value="odd" ${!night || night.ourLane === 'odd' ? 'selected' : ''}>Odd lane</option>
            <option value="even" ${night && night.ourLane === 'even' ? 'selected' : ''}>Even lane</option>
          </select></label>
      </div>
      <label class="field"><span>Opponent</span>
        <select name="opp" data-change="oppPick">
          <option value="">Pick a team…</option>
          ${opponents.map((t) => `<option value="${t.id}" ${night && night.them.teamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          <option value="__new">+ New team…</option>
        </select></label>
      <label class="field" data-newteam hidden><span>New team name</span><input name="newTeam" placeholder="Team name"></label>
      ${l.travel ? `<label class="field"><span>Alley tonight</span><input name="alley" value="${esc(night ? night.alley || '' : '')}"></label>` : ''}
      <button class="btn primary big" type="submit">${night ? 'Save' : 'Start night'}</button>
      ${night ? `<button class="btn danger" type="button" data-act="deleteNight" data-id="${night.id}">Delete this night</button>` : ''}
    </form>
    ${night ? '' : '<p class="muted small">Lineups fill in from your roster and from the last time you faced this team. Tap any name on the recap to change it.</p>'}`;
  viewNightSetup.ctx = { s, l, night };
}

function saveNight(form) {
  const { s, l, night } = viewNightSetup.ctx;
  const f = new FormData(form);
  let oppId = f.get('opp');
  if (oppId === '__new') {
    const t = S.findOrCreateTeam(l.id, f.get('newTeam') || '');
    if (!t) return toast('Enter the new team name');
    oppId = t.id;
  }
  if (!oppId) return toast('Pick the opponent');
  const odd = Number(f.get('odd'));
  if (!Number.isInteger(odd) || odd < 1 || odd % 2 !== 1) return toast('Lane pair must be an odd number, like 27');
  const date = f.get('date');
  if (night) {
    night.date = date;
    night.lanes = { odd, even: odd + 1 };
    night.ourLane = f.get('ourLane');
    if (night.them.teamId !== oppId) {
      night.them = { teamId: oppId, slots: defaultLineup(s, oppId, date, false) };
    }
    if (l.travel) night.alley = f.get('alley');
    S.put('nights', night);
    return go(`#/night/${night.id}`);
  }
  const n = S.put('nights', {
    sessionId: s.id, date, lanes: { odd, even: odd + 1 }, ourLane: f.get('ourLane'), locked: false,
    alley: l.travel ? f.get('alley') : l.alley,
    us: { teamId: l.ourTeamId, slots: defaultLineup(s, l.ourTeamId, date, true) },
    them: { teamId: oppId, slots: defaultLineup(s, oppId, date, false) },
  });
  go(`#/night/${n.id}`);
}

function defaultLineup(s, teamId, date, isOurs) {
  let ids;
  if (isOurs) {
    ids = (s.roster || []).filter((r) => r.role !== 'sub').map((r) => r.bowlerId);
    if (!ids.length) ids = S.lastLineup(teamId, date);
  } else {
    ids = S.lastLineup(teamId, date);
  }
  // Known bowlers first; any open spots on a team we know are VACANT. A team we know
  // nothing about yet shows "+ add" on every spot.
  const slots = [];
  for (let i = 0; i < s.bowlersPerTeam; i++) {
    if (ids[i]) slots.push(S.makeSlot(s, ids[i], date, isOurs));
    else slots.push(ids.length ? S.vacantSlot(s) : S.makeSlot(s, null, date, isOurs));
  }
  return slots;
}

// ---------- the recap sheet ----------

function slotsFor(n) {
  return n.ourLane === 'odd' ? [n.us.slots, n.them.slots] : [n.them.slots, n.us.slots];
}
function matchFor(n, s) {
  const [a, b] = slotsFor(n);
  return computeMatch(a, b, s.gamesPerNight, S.rulesOf(s));
}

function viewNight(id) {
  const n = S.get('nights', id);
  if (!n) return go('#/');
  const s = S.get('sessions', n.sessionId);
  const l = S.get('leagues', s.leagueId);
  setHeader(`${fmtDate(n.date)} · Lanes ${n.lanes.odd}-${n.lanes.even}`, `#/league/${l.id}`);
  const m = matchFor(n, s);
  const oddKey = n.ourLane === 'odd' ? 'us' : 'them';
  const evenKey = n.ourLane === 'odd' ? 'them' : 'us';
  const pU = n.ourLane === 'odd' ? m.pointsA : m.pointsB;
  const pT = n.ourLane === 'odd' ? m.pointsB : m.pointsA;

  $view.innerHTML = `
    <div class="scorebar ${pU.complete ? 'final' : ''}">
      <span>${esc(S.teamName(n.us.teamId))} <b>${pU.final}</b></span>
      <span class="muted small">${pU.complete ? 'Final' : 'So far'} · of ${m.totalPoints}</span>
      <span><b>${pT.final}</b> ${esc(S.teamName(n.them.teamId))}</span>
    </div>
    ${h2hBanner(n, l)}
    <div class="recap">
      ${sideTable(n, s, oddKey, n.lanes.odd, m.A, m.pointsA)}
      ${sideTable(n, s, evenKey, n.lanes.even, m.B, m.pointsB)}
    </div>
    <div class="legend muted small">* average being set tonight · B blind · V vacant · points show once every score for that game is in</div>
    <div class="actions">
      ${n.locked
        ? `<button class="btn" data-act="unlock">🔓 Unlock to edit</button>`
        : `<button class="btn primary" data-act="lock">Finalize &amp; lock night</button>`}
      <a class="btn" href="#/night/${n.id}/edit">Date, lanes, opponent</a>
    </div>`;
  viewNight.ctx = { n, s, l };
}

/** Head-to-head summary against tonight's opponent (other nights only). */
function h2hBanner(n, l) {
  const past = S.nightsOfLeague(l.id).filter((x) => x.id !== n.id && x.them.teamId === n.them.teamId);
  if (!past.length) return '';
  let pf = 0, pa = 0, w = 0, lo = 0, t = 0;
  for (const x of past) {
    const s = S.get('sessions', x.sessionId);
    const m = matchFor(x, s);
    const us = x.ourLane === 'odd' ? m.pointsA : m.pointsB;
    const them = x.ourLane === 'odd' ? m.pointsB : m.pointsA;
    pf += us.final; pa += them.final;
    if (us.final > them.final) w++; else if (us.final < them.final) lo++; else t++;
  }
  const last = past[past.length - 1];
  return `<a class="h2h" href="#/team/${n.them.teamId}">vs ${esc(S.teamName(n.them.teamId))} before: <b>${past.length}</b> night${past.length === 1 ? '' : 's'}, <b>${w}-${lo}${t ? `-${t}` : ''}</b>, points ${pf}-${pa} · last ${esc(fmtDate(last.date))} ›</a>`;
}

/** "Spencer Stavros" -> "Spencer S." so names fit the recap on a phone. */
function shortName(name) {
  const parts = name.trim().split(/\s+/);
  if (name.length <= 11 || parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function sideTable(n, s, key, lane, T, P) {
  const G = s.gamesPerNight;
  const side = n[key];
  const isUs = key === 'us';
  const gh = Array.from({ length: G }, (_, g) => `<th>G${g + 1}</th>`).join('');
  const rows = side.slots.map((slot, i) => {
    const b = T.bowlers[i];
    const name = slot.kind === 'vacant' ? 'VACANT' : slot.kind === 'empty' ? '<span class="muted">+ add</span>' : esc(shortName(S.bowlerName(slot.bowlerId)));
    const avg = isNum(b.avg) ? `${b.avg}${b.provisional ? '*' : ''}` : '—';
    const cells = b.games.map((gm, g) => {
      let txt = isNum(gm.scratch) ? gm.scratch : '·';
      let cls = 'score';
      if (gm.kind === 'blind') { cls += ' blind'; txt = `${txt}<sup>B</sup>`; }
      if (gm.kind === 'vacant') cls += ' vacant';
      return `<td class="${cls}" data-act="score" data-side="${key}" data-i="${i}" data-g="${g}">${txt}</td>`;
    }).join('');
    return `<tr>
      <td class="name" data-act="slot" data-side="${key}" data-i="${i}">${name}</td>
      <td class="edit ${b.provisional ? 'prov' : ''}" data-act="slot" data-side="${key}" data-i="${i}" data-focus="avg">${avg}</td>
      <td class="edit${isNum(slot.hcpOverride) ? ' override' : ''}" data-act="slot" data-side="${key}" data-i="${i}" data-focus="hcp">${b.kind === 'empty' ? '' : b.hcp}</td>
      ${cells}
      <td class="ser">${b.gamesKnown ? b.seriesScratch : ''}</td><td class="ser">${b.gamesKnown ? b.seriesTotal : ''}</td>
    </tr>`;
  }).join('');
  const gameCells = (f) => T.games.map((g) => `<td>${f(g)}</td>`).join('');
  const ptsCells = P.games.map((p) => `<td class="pts">${p.final ? p.pts : ''}</td>`).join('');
  const team = esc(S.teamName(side.teamId));
  return `<section class="side ${isUs ? 'us' : 'them'}">
    <header><span class="lane">Lane ${esc(lane)}</span> <b>${team}</b>${isUs ? ' <span class="tag">us</span>' : ''}
      <span class="sidepts">${P.final} pts</span></header>
    <table>
      <colgroup><col class="c-name"><col class="c-avg"><col class="c-hcp">${'<col>'.repeat(G)}<col class="c-ser"><col class="c-ser"></colgroup>
      <thead><tr><th class="name">Bowler</th><th>Avg</th><th>Hcp</th>${gh}<th>Scr</th><th>+Hcp</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td class="name">Scratch</td><td></td><td></td>${gameCells((g) => g.scratch || '')}<td class="ser">${T.series.scratch || ''}</td><td></td></tr>
        <tr><td class="name">Handicap</td><td></td><td></td>${gameCells((g) => g.hcp)}<td></td><td class="ser">${T.series.hcp}</td></tr>
        <tr class="tot"><td class="name">Total</td><td></td><td></td>${gameCells((g) => (g.started ? g.total : ''))}<td></td><td class="ser">${T.series.total || ''}</td></tr>
        <tr><td class="name">Points</td><td></td><td></td>${ptsCells}<td></td><td class="pts">${P.series.final ? P.series.pts : ''}</td></tr>
        ${P.indiv.length ? `<tr><td class="name">Bowler pts</td><td colspan="${G + 4}" class="small">${P.indiv.map((x, i) => `${i + 1}: ${x.games.reduce((a, g) => a + (g.final ? g.pts : 0), 0) + (x.series.final ? x.series.pts : 0)}`).join(' · ')}</td></tr>` : ''}
      </tfoot>
    </table>
  </section>`;
}

// ---------- bottom sheets: score keypad and lineup editor ----------

function openSheet(html) {
  $sheet.innerHTML = `<button class="sheet-close" data-act="closeSheet" aria-label="Close">✕</button>${html}`;
  $sheet.hidden = false;
  $scrim.hidden = false;
  requestAnimationFrame(() => { $sheet.classList.add('open'); $scrim.classList.add('open'); });
}
function closeSheet() {
  $sheet.classList.remove('open');
  $scrim.classList.remove('open');
  $sheet.hidden = true;
  $scrim.hidden = true;
  keypad.state = null;
}
$scrim.addEventListener('click', closeSheet);

function guardLocked() {
  const { n } = viewNight.ctx;
  if (n.locked) {
    toast('This night is locked. Tap Unlock to edit.');
    return true;
  }
  return false;
}

const keypad = { state: null };

function openKeypad(side, i, g) {
  const { n } = viewNight.ctx;
  const slot = n[side].slots[i];
  if (slot.kind === 'empty') return openSlotEditor(side, i);
  if (slot.kind === 'vacant') return toast('VACANT scores come from the session rules.');
  const cur = slot.games[g];
  keypad.state = { side, i, g, buf: isNum(cur.score) ? String(cur.score) : '' };
  drawKeypad();
}

function drawKeypad() {
  const { n } = viewNight.ctx;
  const { side, i, g, buf } = keypad.state;
  const slot = n[side].slots[i];
  const blind = slot.games[g].blind;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'X', '0', '⌫'];
  openSheet(`
    <div class="sheet-head"><b>${esc(S.bowlerName(slot.bowlerId))}</b> · Game ${g + 1}</div>
    <div class="display">${blind ? 'BLIND' : esc(buf || '—')}</div>
    <div class="keypad">
      ${keys.map((k) => `<button class="key" data-act="key" data-k="${k}">${k === 'X' ? 'Clear' : k}</button>`).join('')}
    </div>
    <div class="keynav">
      <button class="btn ${blind ? 'primary' : ''}" data-act="key" data-k="B">${blind ? 'Not blind' : 'Blind'}</button>
      <button class="btn" data-act="key" data-k="PREV">Prev</button>
      <button class="btn primary" data-act="key" data-k="NEXT">Next</button>
      <button class="btn" data-act="key" data-k="EXIT">Exit</button>
    </div>`);
}

function keypadPress(k) {
  const st = keypad.state;
  if (!st) return;
  const { n } = viewNight.ctx;
  const slot = n[st.side].slots[st.i];
  if (/^\d$/.test(k)) {
    if (st.buf.length < 3) st.buf = (st.buf === '0' ? '' : st.buf) + k;
    if (Number(st.buf) > 300) { st.buf = st.buf.slice(0, -1); toast('300 is the max'); }
    return drawKeypad();
  }
  if (k === '⌫') { st.buf = st.buf.slice(0, -1); return drawKeypad(); }
  if (k === 'X') { st.buf = ''; return drawKeypad(); }
  // Blind, Prev, Next and Exit all save the score on the display. The ✕ closes without saving.
  const gm = slot.games[st.g];
  if (!gm.blind) gm.score = st.buf === '' ? null : Number(st.buf);
  if (k === 'B') {
    gm.blind = !gm.blind;
    if (gm.blind) { gm.score = null; st.buf = ''; }
    S.put('nights', n);
    rerenderNight();
    return drawKeypad();
  }
  S.put('nights', n);
  const to = k === 'NEXT' ? stepCell(st, 1) : k === 'PREV' ? stepCell(st, -1) : null;
  rerenderNight();
  if (k === 'EXIT' || !to) return closeSheet();
  openKeypad(to.side, to.i, to.g);
}

/**
 * Order of entry: odd-lane team top to bottom, then even-lane team, then the next game.
 * dir 1 = next bowler, -1 = previous. Vacant spots are skipped.
 */
function stepCell(st, dir) {
  const { n, s } = viewNight.ctx;
  const order = n.ourLane === 'odd' ? ['us', 'them'] : ['them', 'us'];
  const seq = [];
  for (let g = 0; g < s.gamesPerNight; g++) {
    for (const side of order) n[side].slots.forEach((slot, i) => { if (slot.kind === 'bowler') seq.push({ side, i, g }); });
  }
  const idx = seq.findIndex((c) => c.side === st.side && c.i === st.i && c.g === st.g);
  return seq[idx + dir] || null;
}

function rerenderNight() {
  const y = window.scrollY;
  viewNight(viewNight.ctx.n.id);
  window.scrollTo(0, y);
}

function openSlotEditor(side, i, focus) {
  const { n, s, l } = viewNight.ctx;
  const slot = n[side].slots[i];
  const isUs = side === 'us';
  const teamId = n[side].teamId;
  const takenIds = new Set([...n.us.slots, ...n.them.slots].map((x, j) => x.bowlerId).filter(Boolean));
  takenIds.delete(slot.bowlerId);
  let groups = [];
  if (isUs) {
    const regs = (s.roster || []).filter((r) => r.role !== 'sub').map((r) => r.bowlerId);
    const subs = (s.roster || []).filter((r) => r.role === 'sub').map((r) => r.bowlerId);
    groups.push(['Roster', regs], ['Subs', subs]);
    if (s.rosterPolicy !== 'fixed') {
      const others = S.all('bowlers').map((b) => b.id).filter((id) => !regs.includes(id) && !subs.includes(id));
      groups.push(['Other bowlers (floating subs)', others]);
    }
  } else {
    const known = S.knownMembers(teamId);
    const others = S.all('bowlers').map((b) => b.id).filter((id) => !known.includes(id));
    groups.push([`Seen on ${S.teamName(teamId)}`, known], ['Other bowlers', others]);
  }
  groups = groups.map(([label, ids]) => [label, ids.filter((id) => !takenIds.has(id))]).filter(([, ids]) => ids.length);
  const r = S.rulesOf(s);
  const autoHcp = handicapFor(slot.avg, r);
  const blindToggles = slot.kind !== 'vacant' ? slot.games.map((gm, g) => `
    <label class="check inline-check"><input type="checkbox" data-blind="${g}" ${gm.blind ? 'checked' : ''}> G${g + 1}</label>`).join('') : '';

  openSheet(`
    <div class="sheet-head"><b>Position ${i + 1}</b> · ${esc(S.teamName(teamId))}</div>
    <form data-form="slot" class="form compact">
      <label class="field"><span>Bowler</span>
        <select name="who" data-change="whoPick">
          <option value="">— nobody yet —</option>
          <option value="__vacant" ${slot.kind === 'vacant' ? 'selected' : ''}>VACANT (${r.vacantScore} + ${r.vacantHcp})</option>
          ${groups.map(([label, ids]) => `<optgroup label="${esc(label)}">${ids.map((id) => `<option value="${id}" ${slot.bowlerId === id ? 'selected' : ''}>${esc(S.bowlerName(id))}</option>`).join('')}</optgroup>`).join('')}
        </select></label>
      <label class="field"><span>…or a new bowler</span><input name="newName" placeholder="Name" autocomplete="off"></label>
      ${slot.kind === 'bowler' ? `<label class="field"><span>Edit this bowler's name (fixes it everywhere)</span>
        <input name="rename" value="${esc(S.bowlerName(slot.bowlerId))}" autocomplete="off"></label>` : ''}
      <div data-avgfields ${slot.kind === 'vacant' ? 'hidden' : ''}>
      <div class="two">
        <label class="field"><span>Average</span><input name="avg" type="number" inputmode="numeric" value="${esc(slot.avg ?? '')}" data-orig="${esc(slot.avg ?? '')}"></label>
        <label class="field"><span>Handicap <span data-autohcp>(blank = ${autoHcp})</span></span><input name="hcp" type="number" inputmode="numeric" value="${esc(slot.hcpOverride ?? '')}" data-orig="${esc(slot.hcpOverride ?? '')}"></label>
      </div>
      <label class="check"><input type="checkbox" name="est" ${slot.avgEstablished ? 'checked' : ''}> Average is established
        <span class="muted small">(untick to set it from tonight's games)</span></label>
      <div class="field"><span>Blind for games (late or left early)</span><div class="inline">${blindToggles}</div></div>
      </div>
      <button class="btn primary big" type="submit">Save</button>
    </form>`);
  viewNight.slotCtx = { side, i };
  void l;
  if (focus) {
    const el = $sheet.querySelector(`input[name="${focus}"]`);
    if (el) setTimeout(() => { el.focus(); el.select(); }, 50);
  }
}

/** When a different bowler is picked, show that bowler's usual average right away. */
function onWhoPick(sel) {
  const { n, s } = viewNight.ctx;
  const { side } = viewNight.slotCtx;
  const form = sel.form;
  const fields = form.querySelector('[data-avgfields]');
  fields.hidden = sel.value === '__vacant';
  if (!sel.value || sel.value === '__vacant') return;
  const d = S.defaultAverage(s, sel.value, n.date, side === 'us');
  form.avg.value = d.avg ?? '';
  form.avg.dataset.orig = d.avg ?? '';
  form.hcp.value = '';
  form.est.checked = d.established;
  const rn = form.querySelector('[name=rename]');
  if (rn) rn.closest('.field').hidden = true;
  onAvgInput(form);
}
function onAvgInput(form) {
  const { s } = viewNight.ctx;
  const a = num(form.avg.value);
  form.querySelector('[data-autohcp]').textContent = `(blank = ${handicapFor(a, S.rulesOf(s))})`;
}

function saveSlot(form) {
  const { n, s } = viewNight.ctx;
  const { side, i } = viewNight.slotCtx;
  const f = new FormData(form);
  const slot = n[side].slots[i];
  const isUs = side === 'us';
  let who = f.get('who');
  const newName = (f.get('newName') || '').trim();
  if (newName) {
    const b = S.findOrCreateBowler(newName);
    who = b.id;
    if (isUs && !(s.roster || []).some((r) => r.bowlerId === b.id)) {
      s.roster = [...(s.roster || []), { bowlerId: b.id, role: 'sub' }];
      S.put('sessions', s);
    }
  }
  if (!who) {
    n[side].slots[i] = S.makeSlot(s, null, n.date, isUs);
  } else if (who === '__vacant') {
    n[side].slots[i] = { ...S.makeSlot(s, null, n.date, isUs), kind: 'vacant' };
  } else {
    let target = slot;
    if (who !== slot.bowlerId) {
      // New person in this position: keep any scores already typed.
      target = S.makeSlot(s, who, n.date, isUs);
      if (slot.kind === 'bowler') target.games = slot.games;
      n[side].slots[i] = target;
    } else {
      const rename = (f.get('rename') || '').trim();
      const b = S.get('bowlers', slot.bowlerId);
      if (b && rename && rename !== b.name) { b.name = rename; S.put('bowlers', b); }
    }
    // A different bowler keeps their own usual average unless you typed a new one.
    const avgTyped = form.avg.value !== form.avg.dataset.orig;
    const hcpTyped = form.hcp.value !== form.hcp.dataset.orig;
    const changed = target !== slot;
    if (!changed || avgTyped) {
      target.avg = num(f.get('avg'));
      target.avgEstablished = !!f.get('est') && isNum(target.avg);
    } else if (!newName) {
      // Picked from the list: the form already shows that bowler's defaults.
      target.avgEstablished = !!f.get('est') && isNum(target.avg);
    }
    if (!changed || hcpTyped) target.hcpOverride = num(f.get('hcp'));
    form.querySelectorAll('[data-blind]').forEach((cb) => {
      const g = Number(cb.dataset.blind);
      target.games[g].blind = cb.checked;
      if (cb.checked) target.games[g].score = null;
    });
  }
  S.put('nights', n);
  closeSheet();
  rerenderNight();
}

// ---------- opponent team page ----------

function viewTeam(id) {
  const t = S.get('teams', id);
  if (!t) return go('#/');
  const l = S.get('leagues', t.leagueId);
  setHeader(t.name, `#/league/${l.id}`);
  const nights = S.nightsOfLeague(l.id).filter((n) => n.them.teamId === id).reverse();
  const r = headToHead(l.id).get(id) || { nights: 0, pf: 0, pa: 0, w: 0, l: 0, t: 0 };
  const members = S.knownMembers(id);
  // Each opponent bowler's games against us vs the average they carried.
  const stats = members.map((bid) => {
    let pins = 0, games = 0, avgSum = 0;
    for (const n of nights) for (const slot of n.them.slots) {
      if (slot.bowlerId !== bid) continue;
      for (const g of slot.games) if (!g.blind && isNum(g.score)) { pins += g.score; games++; avgSum += slot.avg || 0; }
    }
    return { bid, games, avgVs: games ? Math.floor(pins / games) : null, carried: games ? Math.floor(avgSum / games) : null };
  });
  $view.innerHTML = `
    <div class="stats">
      <div><b>${r.nights}</b><span>nights faced</span></div>
      <div><b>${r.w}-${r.l}-${r.t}</b><span>W-L-T</span></div>
      <div><b>${r.pf}-${r.pa}</b><span>points</span></div>
      <div><b>${r.nights ? (r.pf / r.nights).toFixed(1) : '—'}</b><span>our pts / night</span></div>
    </div>
    <h2>Bowlers against us</h2>
    <section class="list">
      ${stats.length ? stats.map((x) => `<div class="row"><span>${esc(S.bowlerName(x.bid))}</span>
        <span class="muted">${x.games ? `${x.avgVs} vs us in ${x.games} g · avg ${x.carried} (${x.avgVs - x.carried >= 0 ? '+' : ''}${x.avgVs - x.carried})` : 'no games yet'}</span></div>`).join('') : '<p class="muted">No bowlers recorded yet.</p>'}
    </section>
    <h2>Nights</h2>
    <section class="list">${nights.map((n) => nightRow(n, S.get('sessions', n.sessionId))).join('') || '<p class="muted">Not faced yet.</p>'}</section>
    <form data-form="team" class="form">
      <label class="field"><span>Team name</span><input name="name" value="${esc(t.name)}"></label>
      <button class="btn" type="submit">Rename team</button>
    </form>`;
  viewTeam.ctx = t;
}

// ---------- backup & sharing ----------

function viewBackup() {
  setHeader('Backup & sharing', '#/');
  const leagues = S.all('leagues');
  const last = S.db.meta.lastBackup;
  $view.innerHTML = `
    <p>Your data is stored only in this browser on this phone. Save a backup now and then, and share a league with teammates by sending them the file.</p>
    <p class="muted small">Last backup: ${last ? new Date(last).toLocaleString() : 'never'}</p>
    <button class="btn primary big" data-act="exportAll">Save full backup</button>
    ${leagues.length ? `
      <h2>Share one league</h2>
      <div class="inline">
        <select data-share-league>${leagues.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
        <button class="btn" data-act="exportLeague">Share</button>
      </div>
      <p class="muted small">Sends only that league's sessions, teams, bowlers and nights.</p>` : ''}
    <h2>Import a backup or shared league</h2>
    <p class="muted small">Importing merges: new nights are added, and where both copies changed the same thing, the most recent edit wins. Nothing else is erased.</p>
    <label class="btn file">Choose file…<input type="file" accept="application/json,.json" data-import hidden></label>
    <h2>Import from LeaguePals</h2>
    <p class="small">Brings in every night your team bowled in a LeaguePals league, with both lineups, averages, handicaps and points. Easiest on a computer; share the league to your phone afterwards.</p>
    <ol class="small">
      <li>Add this bookmark: on a computer, drag <a class="chip" href="${esc(BOOKMARKLET)}" data-act="noop">Bowling Recap import</a> to your bookmarks bar. On a phone, <button class="chip" data-act="copyBookmarklet">copy the bookmark code</button>, bookmark any page, then edit that bookmark and paste the code as its address.</li>
      <li>Open your league on leaguepals.com (the page with standings and last week's scores) and tap the bookmark.</li>
      <li>Choose <b>Send to Bowling Recap</b>, or <b>Download file</b> and pick it here:</li>
    </ol>
    <label class="btn file">Choose LeaguePals file…<input type="file" accept="application/json,.json" data-import hidden></label>
    <p class="muted small">Importing again later is safe: nights already here are updated, and nights you entered or unlocked in the app are kept as they are. Repeat for each past league or season.</p>
    <h2>Tips</h2>
    <ul class="small">
      <li>On iPhone, tap Share, then <b>Add to Home Screen</b>. The app then opens full screen, works without a signal, and Safari is less likely to clear its data.</li>
      <li>The app updates itself when a new version is published. Reopen it to get the latest.</li>
    </ul>
    <button class="btn danger" data-act="resetAll">Erase all data on this phone</button>
    <p class="muted small center">Version ${esc(VERSION)}</p>`;
}

async function shareJson(data, filename) {
  const text = JSON.stringify(data, null, 1);
  const file = new File([text], filename, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch (e) {
    if (e.name === 'AbortError') return false;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

function stamp() {
  return todayYmd();
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------- LeaguePals import ----------

const APP_ORIGIN = 'https://dpstavros-claude.github.io';
const BOOKMARKLET = "javascript:(function(){var s=document.createElement('script');s.src='" + APP_ORIGIN + "/bowling-recap/js/lp-export.js?'+Date.now();document.body.appendChild(s);})()";
let pendingLp = null;

window.addEventListener('message', (e) => {
  if (!/^https:\/\/(www\.)?leaguepals\.com$/.test(e.origin)) return;
  if (!e.data || e.data.type !== 'leaguepals-raw' || !e.data.payload || e.data.payload.kind !== RAW_KIND) return;
  pendingLp = e.data.payload;
  if (location.hash === '#/import-lp') viewImportLp(); else go('#/import-lp');
});

function viewImportLp() {
  setHeader('Import from LeaguePals', '#/backup');
  if (!pendingLp) {
    if (window.opener) window.opener.postMessage({ type: 'bowling-recap-ready' }, '*');
    $view.innerHTML = `<div class="empty"><p>Waiting for data from LeaguePals…</p>
      <p class="muted small">Started from the LeaguePals bookmark? This fills in by itself in a moment. Otherwise choose a downloaded file:</p>
      <label class="btn file">Choose LeaguePals file…<input type="file" accept="application/json,.json" data-import hidden></label></div>`;
    return;
  }
  const raw = pendingLp;
  const teams = new Map();
  for (const t of (raw.league && raw.league.teams) || []) if (!/^bye$/i.test(t.name)) teams.set(t._id, t.name);
  for (const m of raw.matches || []) for (const t of m.teams || []) if (t.team && !/^bye$/i.test(t.team.name)) teams.set(t.team._id, t.team.name);
  const sel = viewImportLp.team && teams.has(viewImportLp.team) ? viewImportLp.team : (teams.has(raw.teamId) ? raw.teamId : guessOurTeam(teams));
  let bundle = null, err = null;
  try { bundle = sel ? convertLeaguePals(raw, sel) : null; } catch (x) { err = x.message; }
  const bad = bundle ? bundle.checks.filter((c) => !c.ok) : [];
  $view.innerHTML = `
    <div class="card">
      <div class="card-title">${esc(raw.league && raw.league.name)}</div>
      ${bundle ? `<div class="muted">Imports as league <b>${esc(bundle.leagueName)}</b>, session <b>${esc(bundle.sessionName)}</b></div>` : ''}
    </div>
    <label class="field"><span>Your team in this league</span>
      <select data-change="lpTeam"><option value="">Pick your team…</option>
        ${[...teams].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => `<option value="${esc(id)}" ${id === sel ? 'selected' : ''}>${esc(name)}</option>`).join('')}
      </select></label>
    ${err ? `<p class="banner">${esc(err)}</p>` : ''}
    ${bundle ? `
      <p><b>${bundle.nights.length}</b> nights to import · ${bundle.teams.length - 1} opponent teams · ${bundle.bowlers.length} bowlers</p>
      <p class="small ${bad.length ? '' : 'muted'}">${bad.length
        ? `Points differ from LeaguePals on ${bad.length} night(s): ${bad.map((c) => `${esc(fmtDate(c.date))} (LeaguePals ${c.lp.join('-')}, here ${c.calc.join('-')})`).join('; ')}. Check the session's points rules after importing.`
        : `Points match LeaguePals on all ${bundle.checks.length} nights.`}</p>
      <section class="list">${bundle.nights.slice().reverse().map((n) => {
        const opp = bundle.teams.find((t) => t.lpId === n.oppLpId);
        return `<div class="row"><span><b>${esc(fmtDate(n.date))}</b> vs ${esc(opp ? opp.name : '?')}</span><span class="muted">Lanes ${esc(n.lanes.odd)}-${esc(n.lanes.even)} · ${n.lpPoints.join('-')}</span></div>`;
      }).join('')}</section>
      <button class="btn primary big" data-act="lpImport" ${bundle.nights.length ? '' : 'disabled'}>Import ${bundle.nights.length} nights</button>` : ''}`;
  viewImportLp.bundle = bundle;
}

function guessOurTeam(teams) {
  const ourNames = new Set(S.all('leagues').map((l) => (S.teamName(l.ourTeamId) || '').toLowerCase()));
  for (const [id, name] of teams) if (ourNames.has(name.toLowerCase())) return id;
  return null;
}

function runLpImport() {
  const b = viewImportLp.bundle;
  if (!b) return;
  const r = S.importLeaguePals(b);
  pendingLp = null;
  viewImportLp.team = null;
  toast(`Imported ${r.added} new, ${r.updated} updated${r.kept ? `, kept ${r.kept} of yours` : ''}`);
  viewLeague.sel = r.sessionId;
  go(`#/league/${r.leagueId}`);
}

// ---------- event wiring ----------

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'quickstart': return quickstartPMP();
    case 'score': {
      if (guardLocked()) return;
      return openKeypad(el.dataset.side, Number(el.dataset.i), Number(el.dataset.g));
    }
    case 'slot': {
      if (guardLocked()) return;
      return openSlotEditor(el.dataset.side, Number(el.dataset.i), el.dataset.focus);
    }
    case 'key': return keypadPress(el.dataset.k);
    case 'closeSheet': return closeSheet();
    case 'lock': {
      const { n } = viewNight.ctx;
      n.locked = true;
      S.put('nights', n);
      toast('Night locked');
      return rerenderNight();
    }
    case 'unlock': {
      const { n } = viewNight.ctx;
      n.locked = false;
      S.put('nights', n);
      return rerenderNight();
    }
    case 'addRoster': {
      const inp = document.querySelector('[data-new-bowler]');
      const role = document.querySelector('[data-new-role]').value;
      const b = S.findOrCreateBowler(inp.value);
      if (!b) return;
      const d = viewSessionEdit.draft;
      d.roster = d.roster || [];
      if (!d.roster.some((r) => r.bowlerId === b.id)) d.roster.push({ bowlerId: b.id, role });
      inp.value = '';
      return redrawRoster();
    }
    case 'toggleRole': {
      const x = viewSessionEdit.draft.roster[Number(el.dataset.i)];
      x.role = x.role === 'sub' ? 'regular' : 'sub';
      return redrawRoster();
    }
    case 'rmRoster': {
      viewSessionEdit.draft.roster.splice(Number(el.dataset.i), 1);
      return redrawRoster();
    }
    case 'deleteLeague': {
      if (!confirm('Delete this league and all of its nights?')) return;
      const id = el.dataset.id;
      for (const s of S.sessionsOf(id)) { for (const n of S.nightsOf(s.id)) S.remove('nights', n.id); S.remove('sessions', s.id); }
      S.remove('leagues', id);
      return go('#/');
    }
    case 'deleteSession': {
      if (!confirm('Delete this session and all of its nights?')) return;
      const s = S.get('sessions', el.dataset.id);
      for (const n of S.nightsOf(s.id)) S.remove('nights', n.id);
      S.remove('sessions', s.id);
      return go(`#/league/${s.leagueId}`);
    }
    case 'deleteNight': {
      if (!confirm('Delete this night?')) return;
      const n = S.get('nights', el.dataset.id);
      const s = S.get('sessions', n.sessionId);
      S.remove('nights', n.id);
      return go(`#/league/${s.leagueId}`);
    }
    case 'exportAll': {
      if (await shareJson(S.exportData(null), `bowling-recap-backup-${stamp()}.json`)) { S.markBackedUp(); toast('Backup saved'); viewBackup(); }
      return;
    }
    case 'exportLeague': {
      const id = document.querySelector('[data-share-league]').value;
      const l = S.get('leagues', id);
      await shareJson(S.exportData([id]), `bowling-recap-${slug(l.name)}-${stamp()}.json`);
      return;
    }
    case 'noop': { e.preventDefault(); toast('Drag this link to your bookmarks bar'); return; }
    case 'copyBookmarklet': {
      try { await navigator.clipboard.writeText(BOOKMARKLET); toast('Bookmark code copied'); } catch { prompt('Copy this bookmark code:', BOOKMARKLET); }
      return;
    }
    case 'lpImport': return runLpImport();
    case 'resetAll': {
      if (!confirm('Erase every league, night and bowler on this phone? Save a backup first if unsure.')) return;
      S.resetAll();
      return go('#/');
    }
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('[data-change="pickSession"]')) { viewLeague.sel = el.value; return render(); }
  if (el.matches('[data-change="whoPick"]')) return onWhoPick(el);
  if (el.matches('[data-change="lpTeam"]')) { viewImportLp.team = el.value; return viewImportLp(); }
  if (el.matches('[data-change="oppPick"]')) {
    document.querySelector('[data-newteam]').hidden = el.value !== '__new';
    return;
  }
  if (el.matches('[data-import]')) {
    const file = el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data && data.kind === RAW_KIND) { pendingLp = data; return go('#/import-lp'); }
      const c = S.mergeData(data);
      toast(`Imported: ${c.added} new, ${c.updated} updated`);
      go('#/');
    } catch (err) {
      alert(err.message || 'Could not read that file.');
    }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('.sheet input[name=avg]')) onAvgInput(e.target.form);
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  if (kind === 'league') {
    const m = location.hash.match(/^#\/league\/([^/]+)\/edit$/);
    return saveLeague(form, m ? m[1] : null);
  }
  if (kind === 'session') return saveSession(form);
  if (kind === 'night') return saveNight(form);
  if (kind === 'slot') return saveSlot(form);
  if (kind === 'team') {
    const t = viewTeam.ctx;
    t.name = new FormData(form).get('name').trim() || t.name;
    S.put('teams', t);
    toast('Renamed');
    return viewTeam(t.id);
  }
});

// Re-render the recap when the phone rotates so the layout settles cleanly.
window.matchMedia('(orientation: landscape)').addEventListener('change', () => {
  if (location.hash.startsWith('#/night/') && !location.hash.endsWith('/edit') && keypad.state == null) rerenderNight();
});

// ---------- offline support and updates ----------

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !navigator.serviceWorker.controller) return;
    reloaded = true;
    toast('Updated to the latest version');
  });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

render();
