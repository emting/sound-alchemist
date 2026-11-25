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

  // Rate of AudioContext.currentTime against performance.now(), sampled every second while running.
  qa.audioClock = { samples: 0, firstPerf: null, firstCtx: null, lastPerf: null, lastCtx: null, minRate: null, maxRate: null, sampleRate: null, baseLatency: null, outputLatency: null };
  setInterval(() => {
    try {
      const c = audio.ctx;
      if (!c || c.state !== 'running') return;
      const a = qa.audioClock;
      const perf = performance.now();
      const ctxT = c.currentTime;
      if (a.firstPerf === null) { a.firstPerf = perf; a.firstCtx = ctxT; }
      else if (perf - a.lastPerf > 500) {
        const rate = (ctxT - a.lastCtx) * 1000 / (perf - a.lastPerf);
        a.minRate = a.minRate === null ? rate : Math.min(a.minRate, rate);
        a.maxRate = a.maxRate === null ? rate : Math.max(a.maxRate, rate);
      }
      a.lastPerf = perf; a.lastCtx = ctxT; a.samples += 1;
      a.sampleRate = c.sampleRate; a.baseLatency = c.baseLatency; a.outputLatency = c.outputLatency;
    } catch (_) {}
  }, 1000);

  // MP3 path (builds with a global `audioAssets`): every AudioBufferSourceNode.start() whose buffer
  // is a decoded asset is logged against the game call that was running (release, overload, ...).
  qa.ops = [];
  qa.mp3Unattributed = [];
  let currentOp = null;
  const assets = () => { try { return typeof audioAssets === 'object' && audioAssets ? audioAssets : null; } catch (_) { return null; } };
  const assetReady = (id) => { const a = assets(); try { return !!(a && a.has(id)); } catch (_) { return false; } };
  const assetIdOf = (buffer) => {
    const a = assets();
    if (!a || !buffer || !a.entries) return null;
    for (const [id, entry] of a.entries) if (entry.buffer === buffer) return id;
    return null;
  };
  const runOp = (type, info, fn) => {
    const prev = currentOp;
    const op = { type, ...info, mp3: [], perf: performance.now(), parent: prev ? prev.type : null };
    currentOp = op;
    try { return fn(op); } finally { currentOp = prev; if (prev) { prev.mp3.push(...op.mp3); if (op.plays) (prev.plays = prev.plays || []).push(...op.plays); } qa.ops.push(op); }
  };
  qa.runOp = runOp;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx && Ctx.prototype.createBufferSource) {
    const origCreate = Ctx.prototype.createBufferSource;
    Ctx.prototype.createBufferSource = function (...a) {
      const src = origCreate.apply(this, a);
      const origStart = src.start;
      const ctx = this;
      src.start = function (when = 0, offset = 0, ...rest) {
        const id = assetIdOf(src.buffer);
        if (id) {
          const hit = { id, ctxTime: ctx.currentTime, when, offset, lateMs: when > 0 ? (ctx.currentTime - when) * 1000 : 0 };
          (currentOp ? currentOp.mp3 : qa.mp3Unattributed).push(hit);
        }
        return origStart.call(this, when, offset, ...rest);
      };
      return src;
    };
  }

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
      let ctxBefore = null;
      try { ctxBefore = audio.ctx ? audio.ctx.state : null; } catch (_) {}
      const castsBefore = state.totalCasts;
      let pressed = null;
      try { pressed = state.hand[args[0]] || null; } catch (_) {}
      const out = runOp('press', { card: pressed ? pressed.id : null, assetReady: pressed ? assetReady(pressed.id) : false }, (op) => {
        const r = origInitiate.apply(this, args);
        // A cast that completed inside the press without having been active before it is an instant card.
        op.instant = !before && !state.activeCast && state.totalCasts > castsBefore;
        return r;
      });
      const cast = state.activeCast;
      if (cast && cast !== before) {
        const inp = inputTime();
        qa.castsStarted += 1;
        // Audio-clock builds start the cast when the charge sound becomes audible, not at the input
        // event. startOffsetMs is that designed gap, so the error can be split into offset + jitter.
        const heardAtInput = typeof cast.startAt === 'number' && gameClock() ? audioTimeOf(inp.t) : null;
        cast.__qa = {
          t0: inp.t, startEvent: inp.type, index: qa.castsStarted, ctxBefore, startAt0: typeof cast.startAt === 'number' ? cast.startAt : null, handler0: performance.now(), audio0: audioTime(),
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
        index: cast.__qa.index,
        // AudioContext state just before the press: null means this press created the context.
        ctxStateBeforePress: cast.__qa.ctxBefore,
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
      let inputClockAt = null;
      let audioClockAt = null;
      // The game reads startAt before it calls inputTime(), so snapshot it at the same point.
      const startAtUsed = cast.startAt;
      let origInputTime = null;
      if (clock && typeof cast.startAt === 'number') {
        origInputTime = clock.inputTime;
        clock.inputTime = function (...a) {
          const v = origInputTime.apply(this, a);
          if (releasedAt === null) releasedAt = v;
          // Builds that time the hold twice pass the cast for the input-clock measure.
          if (a.length > 0 && a[0]) { if (inputClockAt === null) inputClockAt = v; } else if (audioClockAt === null) audioClockAt = v;
          return v;
        };
      }
      let out;
      const ready = assetReady(cast.card.id);
      const opsBefore = qa.ops.length;
      try {
        out = runOp('release', { card: cast.card.id, index: cast.__qa.index, assetReady: ready }, (op) => {
          const r = origRelease.apply(this, args);
          op.judgedPeak = state.peakHits > peakHitsBefore;
          op.overload = qa.ops.slice(opsBefore).some((o) => o.type === 'overload');
          rec.mp3Starts = op.mp3.length;
          rec.mp3 = op.mp3;
          rec.assetReady = ready;
          rec.overloadOnRelease = op.overload;
          return r;
        });
      } finally {
        if (origInputTime) clock.inputTime = origInputTime;
      }
      if (releasedAt !== null) {
        rec.judgedElapsedMs = Math.max(0, releasedAt - startAtUsed) * 1000;
        // Non-zero when the build moved the cast origin after the press / during the release call.
        rec.startAtMovedAfterPressMs = cast.__qa.startAt0 === null ? null : (startAtUsed - cast.__qa.startAt0) * 1000;
        rec.startAtMovedDuringReleaseMs = (cast.startAt - startAtUsed) * 1000;
        rec.judgedSource = 'audioClock.inputTime() - activeCast.startAt';
        if (inputClockAt !== null) {
          rec.judgedSource = 'audioClock.inputTime(cast) - activeCast.startAt (input clock); Peak if input OR audio clock is on the peak';
          rec.judgedInputClockMs = Math.max(0, inputClockAt - startAtUsed) * 1000;
          rec.judgedAudioClockMs = audioClockAt === null ? null : Math.max(0, audioClockAt - startAtUsed) * 1000;
        }
      }
      rec.judgedPeak = state.peakHits > peakHitsBefore;
      qa.casts.push(rec);
      renderHud();
      return out;
    };
    // Overload misfire (from the game loop, or from a release past the deadline).
    const origMisfire = window.commitOverloadMisfire;
    if (typeof origMisfire === 'function') {
      window.commitOverloadMisfire = function (...args) {
        const c = state.activeCast;
        if (!c) return origMisfire.apply(this, args);
        return runOp('overload', { card: c.card.id, index: c.__qa ? c.__qa.index : null, assetReady: assetReady(c.card.id) }, () => origMisfire.apply(this, args));
      };
    }
    // Sound entry points that are also called straight from click handlers (codex previews, relics).
    try {
      for (const [name, type] of [['playRelic', 'relic'], ['playInstantCard', 'instantSound'], ['playCardHit', 'cardHitSound']]) {
        const orig = audio[name];
        if (typeof orig !== 'function') continue;
        audio[name] = function (...args) {
          const item = name === 'playCardHit' ? args[1] : args[0];
          const id = item && item.id;
          return runOp(type, { card: id, assetReady: assetReady(id), wantsPeak: name === 'playCardHit' ? !!args[0] : true }, () => orig.apply(this, args));
        };
      }
    } catch (_) {}
    // What the game asked the asset player for: the requested start time against the context
    // clock (how late the call was) and whether a clip was actually started.
    try {
      const a = assets();
      if (a && typeof a.play === 'function') {
        const origPlay = a.play;
        a.play = function (id, opts = {}) {
          const ctxTime = this.ctx ? this.ctx.currentTime : null;
          const out = origPlay.call(this, id, opts);
          const call = { id, when: opts.when || 0, ctxTime, requestedLateMs: opts.when > 0 && ctxTime !== null ? (ctxTime - opts.when) * 1000 : null, fromAttack: !!opts.fromAttack, attackMs: opts.fromAttack && typeof this.attackTime === 'function' ? this.attackTime(id) * 1000 : 0, returned: out };
          if (currentOp) (currentOp.plays = currentOp.plays || []).push(call);
          return out;
        };
      }
    } catch (_) {}
    qa.assetStatus = () => {
      const a = assets();
      if (!a) return null;
      const { status, reason, loaded: fetched, decoded } = a.summary();
      return { status, reason, fetched, decoded, protocol: location.protocol };
    };
    qa.hooked = true;
  });
};
