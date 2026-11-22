// Runs inside the page before the game's own script (page.addInitScript).
// Observes the game without changing its behaviour: the two cast entry points are wrapped
// so every charged cast is logged with (a) the elapsed time the game judged it on and
// (b) the real elapsed time between the two input events that started and released it.
module.exports = function instrument({ toleranceMs }) {
  const qa = (window.__qa = {
    casts: [],
    castsStarted: 0,
    cpuRate: 1,
    frames: { count: 0, sumMs: 0, maxMs: 0, over33: 0, over100: 0 },
  });

  let lastFrame = 0;
  const onFrame = (now) => {
    if (lastFrame) {
      const gap = now - lastFrame;
      const f = qa.frames;
      f.count += 1;
      f.sumMs += gap;
      if (gap > f.maxMs) f.maxMs = gap;
      if (gap > 33.4) f.over33 += 1;
      if (gap > 100) f.over100 += 1; // the game clamps dt to 100ms, so these frames lose time
    }
    lastFrame = now;
    requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);

  const inputTime = () => {
    const e = window.event;
    return e && e.timeStamp > 0 ? { t: e.timeStamp, type: e.type } : { t: performance.now(), type: 'none' };
  };
  const audioTime = () => {
    try { return audio.ctx && audio.ctx.state === 'running' ? audio.ctx.currentTime : null; } catch (_) { return null; }
  };

  // Builds where judgment runs on the AudioContext clock expose a global `audioClock`.
  const gameClock = () => {
    try { return typeof audioClock === 'object' && audioClock && typeof audioClock.inputTime === 'function' ? audioClock : null; } catch (_) { return null; }
  };
  // Audio-timeline position of a page-time instant, read straight from the context (not via the game).
  const audioTimeOf = (perfMs) => {
    try {
      const c = audio.ctx;
      if (!c || c.state !== 'running' || !c.getOutputTimestamp) return null;
      const ts = c.getOutputTimestamp();
      if (!(ts.performanceTime > 0) || !(ts.contextTime > 0)) return null;
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    } catch (_) { return null; }
  };

  // On-screen readout so the recorded video shows the measurements as they are taken.
  // Fixed, non-interactive and inside the viewport, so it cannot affect input or overflow.
  let hud = null;
  let overflowText = 'overflow: not checked yet';
  const renderHud = () => {
    if (!hud) return;
    const errs = qa.casts.map((c) => Math.abs(c.judgedElapsedMs - c.trueElapsedMs));
    const last = qa.casts[qa.casts.length - 1];
    const within = errs.filter((e) => e <= toleranceMs).length;
    const lastErr = last ? last.judgedElapsedMs - last.trueElapsedMs : null;
    hud.textContent = [
      `QA  CPU ${qa.cpuRate}x  ${window.innerWidth}px  ACT ${state.act} wave ${state.wave}/${state.maxWaves}`,
      `peak casts ${errs.length}  within +-${toleranceMs}ms: ${within}/${errs.length}  max |err| ${errs.length ? Math.max(...errs).toFixed(1) : '-'}ms`,
      last ? `last ${last.card}: judged-real ${lastErr.toFixed(1)}ms ${Math.abs(lastErr) <= toleranceMs ? 'OK' : 'FAIL'}  game says ${last.judgedPeak ? 'PEAK' : 'miss'}` : 'last: -',
      overflowText,
    ].join('\n');
  };
  qa.setOverflow = (text) => { overflowText = text; renderHud(); };
  qa.renderHud = renderHud;

  document.addEventListener('DOMContentLoaded', () => {
    hud = document.createElement('pre');
    hud.id = 'qaHud';
    hud.style.cssText = 'position:fixed;top:0;right:0;z-index:9999;margin:0;padding:3px 6px;max-width:100%;box-sizing:border-box;font:10px/1.3 monospace;color:#a7f3d0;background:rgba(0,0,0,.82);pointer-events:none;white-space:pre-wrap;';
    document.body.appendChild(hud);
    renderHud();

    const origInitiate = window.initiateCardCast;
    const origRelease = window.releaseActiveCast;
    if (typeof origInitiate !== 'function' || typeof origRelease !== 'function') {
      qa.hookError = 'initiateCardCast/releaseActiveCast not found on window';
      return;
    }

    window.initiateCardCast = function (...args) {
      const before = state.activeCast;
      const out = origInitiate.apply(this, args);
      const cast = state.activeCast;
      if (cast && cast !== before) {
        const inp = inputTime();
        qa.castsStarted += 1;
        // Audio-clock builds start the cast when the charge sound becomes audible, not at the input
        // event. startOffsetMs is that designed gap, so the error can be split into offset + jitter.
        const heardAtInput = typeof cast.startAt === 'number' && gameClock() ? audioTimeOf(inp.t) : null;
        cast.__qa = {
          t0: inp.t, startEvent: inp.type, handler0: performance.now(), audio0: audioTime(),
          startOffsetMs: heardAtInput === null ? null : (cast.startAt - heardAtInput) * 1000,
        };
      }
      return out;
    };

    window.releaseActiveCast = function (...args) {
      const cast = state.activeCast;
      if (!cast || !cast.__qa) return origRelease.apply(this, args);
      const inp = inputTime();
      const a1 = audioTime();
      const peakHitsBefore = state.peakHits;
      const rec = {
        card: cast.card.id,
        act: state.act,
        wave: state.wave,
        bossWave: state.wave === state.maxWaves,
        cpuRate: qa.cpuRate,
        startEvent: cast.__qa.startEvent,
        releaseEvent: inp.type,
        peakTimeMs: cast.peakTime * 1000,
        windowMs: cast.windowSec * 1000,
        judgedElapsedMs: cast.elapsed * 1000,
        judgedSource: 'activeCast.elapsed',
        startOffsetMs: cast.__qa.startOffsetMs,
        trueElapsedMs: inp.t - cast.__qa.t0,
        handlerElapsedMs: performance.now() - cast.__qa.handler0,
        audioElapsedMs: a1 !== null && cast.__qa.audio0 > 0 ? (a1 - cast.__qa.audio0) * 1000 : null,
      };
      // Audio-clock builds judge the release on audioClock.inputTime() - cast.startAt, and
      // activeCast.elapsed is only a display getter there. Capture the value the game really
      // compares against the peak by passing the call through (return value untouched).
      const clock = gameClock();
      let releasedAt = null;
      let origInputTime = null;
      if (clock && typeof cast.startAt === 'number') {
        origInputTime = clock.inputTime;
        clock.inputTime = function (...a) {
          const v = origInputTime.apply(this, a);
          if (releasedAt === null) releasedAt = v;
          return v;
        };
      }
      let out;
      try {
        out = origRelease.apply(this, args);
      } finally {
        if (origInputTime) clock.inputTime = origInputTime;
      }
      if (releasedAt !== null) {
        rec.judgedElapsedMs = Math.max(0, releasedAt - cast.startAt) * 1000;
        rec.judgedSource = 'audioClock.inputTime() - activeCast.startAt';
      }
      rec.judgedPeak = state.peakHits > peakHitsBefore;
      qa.casts.push(rec);
      renderHud();
      return out;
    };
    qa.hooked = true;
  });
};
