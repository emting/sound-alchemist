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
| `QA_OFFPEAK_EVERY` | `0` (off) | Make every Nth charged cast a deliberate off-peak release (15-200ms beyond the window edge) |
| `QA_HTTP` | off | `1` serves the game's directory over `http://127.0.0.1` so the MP3 assets load (they are not fetched on `file://`) |
| `QA_CHROMIUM_ARGS` | none | Extra Chromium flags, e.g. `--disable-audio-output` (Chromium's built-in null audio sink) |
| `QA_AUDIO_LABEL` | none | Free-text label for the audio output setup, copied into the results |

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

The boss-playthrough result also records the audio setup (`audioSink`, via `pactl` when available) and the
rate of `AudioContext.currentTime` against `performance.now()` (`audioClock`), plus per cast whether the
press created the context and whether the build moved the cast origin after the press. To run the boss
test alone in a freshly launched browser (first AudioContext of the process): `npx playwright test -g "3 Act Bosses"`.

## Reference outside the page

Builds that time the hold from the press/release event timestamps subtract the same two numbers the
±5ms check uses as its reference, so on those builds that check reads ~0ms by construction and is not
independent evidence. The harness therefore also records Node's monotonic clock around every input
command (sent / acknowledged). The real hold lies inside that bracket; send-to-send is the point
estimate. The boss test fails if a verdict contradicts the whole bracket by more than 5ms; the point
estimate, the bracket width and the difference from the event timestamps are reported.

`QA_STARTUP=1 npx playwright test startup` runs `tests/startup.spec.js`: each case launches its own
browser and makes three casts. `QA_STARTUP_OFFSETS` sets the first cast's release offset in ms, or
`audio` to hold until the game's audio-clock elapsed time reaches the peak. `QA_SUSPEND_MS` instead
suspends the PulseAudio sink that long during cast 3 (an audio-clock stall induced from outside the page).

## MP3 path (`QA_HTTP=1`)

On `file://` the game falls back to the synthesizer, so the MP3 code never runs. With `QA_HTTP=1` the
harness serves the game over HTTP, waits for the asset fetches, and logs every
`AudioBufferSourceNode.start()` whose buffer is a decoded asset against the game call that was running.
The boss test then also fails unless 40/40 assets decoded and, for sounds whose asset was decoded:
Peak release started exactly 1 MP3, off-Peak release 0, overload 0, instant card 1, relic 1, with no
unattributed starts. A third test (`MP3 path ...`) covers what the campaign bot rarely triggers:
overload misfires (held past the deadline and released just past it), codex previews of all 30 cards
and 10 relics, and a shop relic purchase. That test restarts the game and sets gold through
`page.evaluate` as set-up; the sounds themselves are triggered by real clicks and keys.

All tests now also fail on page errors, console errors and failed or 4xx/5xx requests.
The simulator test checks 10 executions x 10 rows x 18 waves; it does not require every run to be a
full clear (the simulator shuffles its deck with `Math.random`).
