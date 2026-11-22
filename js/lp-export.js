// LeaguePals exporter. Loaded by the "Bowling Recap import" bookmark while you are on a
// leaguepals.com league page. It reads that league's public scores (the same data the page
// shows) and hands them to Bowling Recap. It never reads or sends your LeaguePals password.
(function () {
  var APP = 'https://dpstavros-claude.github.io/bowling-recap/';
  var BOX_ID = 'bowling-recap-export';

  function box(html) {
    var el = document.getElementById(BOX_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BOX_ID;
      el.style.cssText = 'position:fixed;z-index:2147483647;left:12px;right:12px;top:12px;max-width:460px;margin:0 auto;' +
        'background:#fff;color:#1b1f1a;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);padding:16px;' +
        'font:16px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif';
      document.body.appendChild(el);
    }
    el.innerHTML = '<div style="font-weight:700;margin-bottom:6px">Bowling Recap import</div>' + html;
    return el;
  }
  var btn = 'display:block;width:100%;min-height:44px;margin-top:8px;border-radius:10px;border:1px solid #14532d;font:inherit;font-weight:600;';

  var q = new URLSearchParams(location.search);
  var leagueId = q.get('id');
  var teamId = q.get('teamid');
  if (location.hostname.indexOf('leaguepals.com') < 0 || !leagueId) {
    box('<p>Open your league page on leaguepals.com first (the page with the standings and last week\'s scores), then tap the bookmark again.</p>' +
      '<button style="' + btn + 'background:#fff" onclick="this.parentNode.remove()">Close</button>');
    return;
  }

  box('<p>Reading this league from LeaguePals…</p>');
  var get = function (u) { return fetch(u, { credentials: 'include' }).then(function (r) { return r.json(); }); };
  Promise.all([
    get('/fullLeagueInfoPublic?id=' + encodeURIComponent(leagueId)),
    get('/recentScoresPublic?leagueId=' + encodeURIComponent(leagueId) + '&minDate=0&maxDate=' + (Date.now() + 400 * 864e5) + '&weekIdx=0'),
  ]).then(function (res) {
    var league = res[0] && res[0].data;
    var matches = (res[1] && res[1].data) || [];
    if (!league) throw new Error('LeaguePals did not return this league.');
    var raw = { app: 'bowling-recap', kind: 'leaguepals-raw', version: 1, fetchedAt: new Date().toISOString(), leagueId: leagueId, teamId: teamId, league: league, matches: matches };
    var ours = teamId ? matches.filter(function (m) { return m.teams && m.teams.some(function (t) { return t.team && t.team._id === teamId; }); }).length : null;
    var teamName = '';
    (league.teams || []).forEach(function (t) { if (t._id === teamId) teamName = t.name; });
    var json = JSON.stringify(raw);
    var fileName = 'leaguepals-' + String(league.name || 'league').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';

    var el = box('<p><b>' + escapeHtml(league.name || '') + '</b><br>' + matches.length + ' matches' +
      (ours != null ? ', ' + ours + ' for ' + escapeHtml(teamName || 'your team') : '') + '.</p>' +
      '<button data-x="send" style="' + btn + 'background:#14532d;color:#fff">Send to Bowling Recap</button>' +
      '<button data-x="file" style="' + btn + 'background:#fff;color:#14532d">Download file</button>' +
      '<button data-x="close" style="' + btn + 'background:#fff;color:#667064;border-color:#dfe3dc">Close</button>' +
      '<p style="font-size:13px;color:#667064;margin:10px 0 0">Using the app from your iPhone home screen? Choose <b>Download file</b>, then in the app go to Backup &amp; sharing → Import from LeaguePals and pick the file.</p>');

    el.addEventListener('click', function (e) {
      var x = e.target.getAttribute && e.target.getAttribute('data-x');
      if (x === 'close') el.remove();
      if (x === 'file') {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      }
      if (x === 'send') {
        var w = window.open(APP + '#/import-lp', '_blank');
        if (!w) { alert('Your browser blocked the new tab. Use Download file instead.'); return; }
        var sent = false;
        var onMsg = function (ev) {
          if (ev.origin !== new URL(APP).origin || !ev.data || ev.data.type !== 'bowling-recap-ready' || sent) return;
          sent = true;
          w.postMessage({ type: 'leaguepals-raw', payload: raw }, new URL(APP).origin);
          window.removeEventListener('message', onMsg);
        };
        window.addEventListener('message', onMsg);
      }
    });
  }).catch(function (err) {
    box('<p>Could not read the league: ' + escapeHtml(err.message || String(err)) + '</p>' +
      '<button style="' + btn + 'background:#fff" onclick="this.parentNode.remove()">Close</button>');
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
})();
