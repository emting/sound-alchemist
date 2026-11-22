# Stress + CPU-throttled QA harness

Playwright harness for `../sound_alchemist.html`. It does not modify the game; it loads the file
as-is in Chromium at a 480px-wide viewport, applies CDP CPU throttling (4x by default) and records video.

```bash
cd qa
npm install
npx playwright install chromium
npm test          # videos land in qa/test-results/, raw numbers in qa/results/
npm run report    # Markdown summary of the last run
```

## What it checks

| Test | What runs | Assertions |
|---|---|---|
| Simulator | Opens the in-game 10-run / 18-wave simulator and re-runs it 10 times under throttle; opens shop, codex and guide modals | 10 runs per execution, each an 18-wave campaign; no horizontal overflow |
| Boss playthrough | A bot plays the full 18-wave campaign with real mouse/keyboard input (tap + Space and hold + release casts, Q/W/E parries) until all 3 Act Bosses are defeated | Peak registration within ±5ms; no wrong Peak/miss verdicts; all 3 bosses defeated; no horizontal overflow |

### Peak registration accuracy

For every charged cast the harness records, without changing game behaviour:

- **real elapsed**: time between the input event that started the charge and the input event that released it (`Event.timeStamp`);
- **judged elapsed**: the value the game compared against the peak when it ruled Peak or miss.

A small readout in the top-right corner shows these numbers live so they are visible in the video.

The test fails if `|judged - real|` exceeds 5ms for any cast, or if the game's Peak/miss verdict contradicts
the real timing by more than 5ms. The bot aims releases at the peak, mid-window and just inside the window edge.

### Horizontal overflow

At each checkpoint (battle screen, every modal, each boss fight, game over) the document's `scrollWidth`
must not exceed the 480px viewport and no visible, unclipped element may extend past either edge.

## Options

| Env var | Default | Meaning |
|---|---|---|
| `QA_CPU_RATE` | `4` | CDP CPU throttling rate (`1` = unthrottled baseline) |
| `QA_SIM_ITERATIONS` | `10` | Simulator executions |
| `QA_PLAY_BUDGET_MIN` | `30` | Time budget for the boss playthrough |
| `QA_MAX_ATTEMPTS` | `6` | Campaign restarts allowed if the bot loses |
| `QA_GAME_FILE` | `../sound_alchemist.html` | Game file to test, e.g. another branch's worktree |
| `QA_RESULTS_DIR` | `qa/results` | Where the JSON results are written and read by `npm run report` |

Notes: the page needs network access (Tailwind CDN, Google Fonts). Frame times, and therefore timing
results, depend on the machine. The measured throttle slowdown is written to the results; it is noisy on shared
machines, so the test only requires it to be clearly above 1x.

## Builds that judge on the AudioContext clock

If the game exposes a global `audioClock` and `state.activeCast.startAt`, the judged time is read as
`audioClock.inputTime() - activeCast.startAt` (captured by passing the game's own call through),
because `activeCast.elapsed` is then only a display getter. The reference is unchanged: real time
between the start and release input events, and the ±5ms checks are the same.

Such builds start the cast when the charge sound becomes audible, not at the start input. The report
shows that gap (`startOffsetMs`) and the error with it removed as diagnostics; they are never asserted on.
