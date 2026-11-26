# Changelog

## 0.2.1 (2026-11-26)

- Opponent bowlers and averages fill in on a new night even if you haven't bowled that team yet: the LeaguePals import now saves every team's latest lineup from the whole league. Re-run the import before league night to keep them current. A team with no history at all shows "+ add".
- If a team has only 1 to 3 known bowlers, the open spots are VACANT with the session's vacant average and handicap.
- Lane pair accepts odd numbers only.
- Points for a game show only after all scores for that game are in; series points only after every game is done. Projected points are gone.
- Score keypad: Blind, Prev, Next and Exit all save the score; the ✕ closes without saving.

## 0.2.0 (2026-11-22)

- Import from LeaguePals: a bookmark run on a leaguepals.com league page sends every night your team bowled (both lineups, averages, handicaps, subs, blinds, vacants, lanes) to the app, or saves it as a file to import. Points are recalculated and compared with LeaguePals before importing.
- Re-importing is safe: imported nights are updated; nights you entered or unlocked in the app are kept.
- Imported bowlers join the session roster, so averages and lineups prefill for the next night.
- The recap shows your record against tonight's opponent (nights, W-L, points, last time you met).

## 0.1.1 (2026-11-22)

- Tap a bowler's Avg or Hcp on the recap to edit it; a handicap you type yourself shows in orange.
- Fix a bowler's name from the recap (it changes everywhere).
- Picking a different bowler fills in their usual average right away, and you can adjust it before saving.
- Average and handicap can be set when filling an empty position.

## 0.1.0 (2026-11-22)

First version: live recap sheet.

- Leagues, sessions and rosters, with every scoring rule configurable per session.
- One-tap setup for Tuesday PMP (Beer Frame, AMF Deltona Lanes, 90% of 220, 8 points a night).
- Start a night: date defaults to the next league night, lineups prefill from the roster and the last time you faced the opponent.
- Recap sheet: odd lane on top in portrait, side by side in landscape; number pad score entry that walks bowler to bowler.
- Handicap, VACANT, BLIND (per game), averages established during the night, live projected points.
- Finalize and lock a night; unlock to correct.
- Opponent page with head-to-head record and each bowler's games against us vs their average.
- Full backup, single-league share, and merging import.
- Works offline and can be added to the iPhone home screen.
