# Bowling Recap

A phone-first web app for filling in a bowling league recap sheet live, and keeping the history of our team and every opponent we face.

**Open the app:** https://dpstavros-claude.github.io/bowling-recap/ (once GitHub Pages is turned on)

## For teammates

1. Open the link above in Safari on your iPhone.
2. Tap **Share**, then **Add to Home Screen**. The app then opens full screen, works without a signal at the lanes, and iOS is much less likely to clear its data.
3. Your data lives only on your phone. To share a league, open **Backup & sharing**, tap **Share** next to the league, and send the file. The other person imports it from the same screen; imports merge, they never erase.
4. Save a full backup now and then. The home screen reminds you after 2 weeks.

The app updates itself: when a new version is published, reopen it to get it. The version number is at the bottom of the home and backup screens.

## Importing history from LeaguePals

In the app, open **Backup & sharing → Import from LeaguePals** and follow the three steps there. In short: add the *Bowling Recap import* bookmark, open your league on leaguepals.com, tap the bookmark, then choose **Send to Bowling Recap** (or **Download file** and pick it in the app). Repeat for each past league or season. It uses the same public scores LeaguePals shows on the page; your LeaguePals login is never read.

The home-screen app on iPhone keeps its own data, separate from Safari, so on a phone use **Download file**, or import on a computer and share the league to your phone.

## How scoring works

All rules are set per session (**League → Session rules & roster**):

- **Handicap:** a percent of a base (Tuesday PMP: 90% of 220), rounded down, never below 0, with an optional cap.
- **Averages:** total pins / games, rounded down (USBC). Our bowlers' averages are calculated from earlier nights in the session; any average or handicap can be overridden on the recap by tapping the bowler's name.
- **New bowler / first night:** untick "Average is established" and the average is set from tonight's games as they are entered, with handicap and points re-projected after each game.
- **VACANT:** the session's vacant score and handicap.
- **BLIND:** average minus the blind penalty (10), with the normal handicap; can be set per game for late arrivals or early exits.
- **Points:** team points per game and for the series, on handicap or scratch, with configurable tie points, plus optional bowler-vs-bowler points.

## Development

No build step: plain HTML, CSS and JavaScript modules.

```sh
npm test          # scoring unit tests (Node 18+)
npm start         # serves the app at http://localhost:8000
```

- `js/scoring.js` pure scoring functions (tested in `tests/`)
- `js/store.js` data model, localStorage, backup and merge
- `js/app.js` screens and recap sheet
- `js/leaguepals.js` converts LeaguePals data (tested); `js/lp-export.js` is the script the bookmark loads on leaguepals.com
- `sw.js` offline cache. **Bump `VERSION` in both `js/version.js` and `sw.js` for every release**, and add a line to `CHANGELOG.md`.

Every push to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/pages.yml`). Pull requests run the tests only.

See `CHANGELOG.md` for versions and the project plan for what comes next (LeaguePals import, sharing, stats, predictions).
