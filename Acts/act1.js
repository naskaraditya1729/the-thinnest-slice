/* ============================================================================
   Act I — THE PROBLEM
   Self-contained module. Interface to script.js:
     enter(ctx) / exit()   — see the header of script.js.
   Everything created here (listeners, timers, rAF loops, audio nodes, DOM) is
   released in destroy(), so the Act can be entered, exited and re-entered.

   The eight slots are a visual metaphor for limited memory only.
   They are NOT any algorithm's data structure.

   Sound is synthesised live with Web Audio (no audio files). All levels live
   in the SND block below.
   ========================================================================== */

(function () {
  'use strict';

  const TTS = window.TheThinnestSlice;
  if (!TTS || typeof TTS.registerAct !== 'function') {
    console.error('[Act I] Controller not found; script.js must load first.');
    return;
  }

  /* ---- Content (exact specified copy) ----------------------------------- */

  const COPY = {
    s1: [
      'Imagine counting every single one.',
      'Every character.',
      'Every arrival.',
      'Nothing missed.'
    ],
    s2: [
      'The stream has no reason to stop.',
      'And you cannot remember everything.'
    ],
    s2q: 'Can you still figure out how many different elements have arrived?',
    s3q: 'How many elements have arrived?',
    s3expl: [
      'The number of arrivals tells us how much data has passed through the stream.',
      'The number of distinct elements tells us how many different values it contains.',
      'Our problem is to estimate the second quantity.'
    ],
    s4lines: [
      'Exact counting is straightforward when memory is unlimited.',
      'But a massive stream may contain far more elements than we can afford to store.',
      'And the stream may never end.'
    ],
    s4challenge: 'Can we estimate the number of distinct elements without remembering them all?',
    s4support: 'Massive data streams. Limited memory. An accurate estimate.',
    closing: 'THE CHALLENGE BEGINS.',
    gate: 'CLICK OR PRESS ENTER TO CONTINUE'
  };

  const STREAM = ['A', 'B', 'A', 'C', 'D', 'B', 'E', 'C'];
  const MILESTONES = [10000, 1000000, 100000000, 1000000000];
  const ARC_H = 56;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---- Sound design constants ------------------------------------------- */

  const SND = {
    drone: 0.11,     // ambient bed
    rain: 0.045,     // noise hiss
    sparkle: 0.014,  // glyph shimmer
    tick: 0.02,      // counter ticks
    chime: 0.07,     // bells
    riser: 0.05      // Scene 2 tension riser
  };
  // D major pentatonic
  const PENT_HI = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66, 1318.51, 1479.98, 1760.0];
  const PENT_LO = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99];
  const LETTER_HZ = { A: 293.66, B: 329.63, C: 369.99, D: 440.0, E: 493.88 };
  const MOODS = {
    rain: { root: 55.0,  fifth: 82.41,  third: 65.41,  oct: 110.0,  g3: 0 },
    calm: { root: 73.42, fifth: 110.0,  third: 92.5,   oct: 146.83, g3: 0.4 },
    warm: { root: 73.42, fifth: 110.0,  third: 92.5,   oct: 185.0,  g3: 0.6 },
    low:  { root: 36.71, fifth: 55.0,   third: 46.25,  oct: 73.42,  g3: 0.2 }
  };
  const SND_API = ['setMood', 'setDrone', 'setRain', 'setSparkle', 'setTick', 'setRiser',
    'chime', 'note', 'dull', 'pop', 'confirm', 'milestone', 'eight', 'glimmer',
    'impact', 'swell', 'freeze', 'restore', 'fadeOut', 'destroy'];

  /* ========================================================================
     Procedural sound engine for this Act
     ====================================================================== */

  function createSound(audio) {
    const ac = audio && audio.context ? audio.context() : null;
    if (!ac || !audio.output) {
      const stub = {};
      SND_API.forEach(function (k) { stub[k] = function () {}; });
      return stub;
    }

    const running = audio.running;
    const bus = ac.createGain();
    bus.gain.value = 1;
    bus.connect(audio.output);

    /* Reverb (generated impulse response) */
    function impulse(len, decay) {
      const n = Math.floor(ac.sampleRate * len);
      const b = ac.createBuffer(2, n, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
      return b;
    }
    const verb = ac.createConvolver();
    verb.buffer = impulse(3.4, 2.6);
    const verbOut = ac.createGain();
    verbOut.gain.value = 0.7;
    verb.connect(verbOut);
    verbOut.connect(bus);
    const send = ac.createGain();
    send.gain.value = 1;
    send.connect(verb);

    /* Shared noise buffer */
    const noiseBuf = (function () {
      const n = ac.sampleRate * 2;
      const b = ac.createBuffer(1, n, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();

    const ramp = function (param, v, secs) {
      const t = ac.currentTime;
      param.cancelScheduledValues(t);
      param.setTargetAtTime(v, t, Math.max(0.005, secs / 3));
    };

    /* Drone bed: five voices, mood-driven pitches */
    const droneGain = ac.createGain();
    droneGain.gain.value = 0;
    const droneLP = ac.createBiquadFilter();
    droneLP.type = 'lowpass';
    droneLP.frequency.value = 320;
    droneLP.Q.value = 0.4;
    droneLP.connect(droneGain);
    droneGain.connect(bus);
    const droneWet = ac.createGain();
    droneWet.gain.value = 0.35;
    droneGain.connect(droneWet);
    droneWet.connect(send);

    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ac.createGain();
    lfoAmt.gain.value = 90;
    lfo.connect(lfoAmt);
    lfoAmt.connect(droneLP.frequency);

    const M0 = MOODS.rain;
    const longOscs = [lfo];
    function voice(type, freq, gain) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ac.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(droneLP);
      longOscs.push(o);
      return { o: o, g: g };
    }
    const vRoot = voice('sine', M0.root, 1);
    const vRoot2 = voice('sine', M0.root * 1.006, 0.8);
    const vFifth = voice('triangle', M0.fifth, 0.45);
    const vThird = voice('sine', M0.third, M0.g3);
    const vOct = voice('triangle', M0.oct, 0.3);

    /* Rain hiss */
    const rainSrc = ac.createBufferSource();
    rainSrc.buffer = noiseBuf;
    rainSrc.loop = true;
    const rainHP = ac.createBiquadFilter();
    rainHP.type = 'highpass';
    rainHP.frequency.value = 500;
    const rainBP = ac.createBiquadFilter();
    rainBP.type = 'bandpass';
    rainBP.frequency.value = 1800;
    rainBP.Q.value = 0.5;
    const rainGain = ac.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(rainHP);
    rainHP.connect(rainBP);
    rainBP.connect(rainGain);
    rainGain.connect(bus);
    longOscs.push(rainSrc);

    /* Riser (Scene 2 tension) */
    const riseLP = ac.createBiquadFilter();
    riseLP.type = 'lowpass';
    riseLP.frequency.value = 150;
    const riseGain = ac.createGain();
    riseGain.gain.value = 0;
    riseLP.connect(riseGain);
    riseGain.connect(bus);
    const riseA = ac.createOscillator();
    riseA.type = 'sawtooth';
    riseA.frequency.value = 55;
    const riseB = ac.createOscillator();
    riseB.type = 'sawtooth';
    riseB.frequency.value = 55.5;
    riseA.connect(riseLP);
    riseB.connect(riseLP);
    longOscs.push(riseA, riseB);

    longOscs.forEach(function (o) { o.start(); });

    /* Event loops (counter ticks, glyph sparkle) */
    let dead = false;
    let sparkleRate = 0, tickRate = 0, tickHz = 300;
    const loopTimers = new Set();

    function loop(getRate, fn) {
      (function step() {
        if (dead) return;
        const r = getRate();
        const waitMs = r > 0 ? (1000 / r) * (0.6 + Math.random() * 0.8) : 120;
        const id = setTimeout(function () {
          loopTimers.delete(id);
          if (dead) return;
          if (r > 0 && running()) fn();
          step();
        }, waitMs);
        loopTimers.add(id);
      })();
    }

    /* One-shot voice */
    function tone(f, o) {
      if (dead || !running()) return;
      o = o || {};
      const t = ac.currentTime + (o.delay || 0);
      const att = o.att == null ? 0.01 : o.att;
      const dur = o.dur || 1;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.gain || 0.05, t + att);
      g.gain.exponentialRampToValueAtTime(0.0001, t + att + dur);
      g.connect(bus);
      if (o.wet !== false) g.connect(send);
      const parts = o.bell ? [[1, 1], [2.76, 0.22], [5.4, 0.08]] : [[1, 1]];
      parts.forEach(function (p, i) {
        const osc = ac.createOscillator();
        osc.type = o.type || 'sine';
        osc.frequency.value = f * p[0];
        const pg = ac.createGain();
        pg.gain.value = p[1];
        osc.connect(pg);
        pg.connect(g);
        osc.start(t);
        osc.stop(t + att + dur + 0.05);
        osc.onended = function () {
          osc.disconnect();
          pg.disconnect();
          if (i === parts.length - 1) g.disconnect();
        };
      });
    }

    loop(function () { return sparkleRate; }, function () {
      const f = PENT_HI[(Math.random() * PENT_HI.length) | 0];
      tone(f, { gain: SND.sparkle * (0.5 + Math.random()), att: 0.004, dur: 0.5 + Math.random() * 0.7 });
    });
    loop(function () { return tickRate; }, function () {
      tone(tickHz * (1 + Math.random() * 0.02), { type: 'triangle', gain: SND.tick, att: 0.002, dur: 0.03, wet: false });
    });

    /* ---- API ---- */

    const api = {
      setMood: function (name, secs) {
        const m = MOODS[name];
        if (!m) return;
        ramp(vRoot.o.frequency, m.root, secs);
        ramp(vRoot2.o.frequency, m.root * 1.006, secs);
        ramp(vFifth.o.frequency, m.fifth, secs);
        ramp(vThird.o.frequency, m.third, secs);
        ramp(vOct.o.frequency, m.oct, secs);
        ramp(vThird.g.gain, m.g3, secs);
      },
      setDrone: function (level, secs) { ramp(droneGain.gain, level * SND.drone, secs); },
      setRain: function (level, secs) {
        ramp(rainGain.gain, level * SND.rain, secs);
        ramp(rainBP.frequency, 1400 + level * 1600, secs);
      },
      setSparkle: function (rate) { sparkleRate = rate; },
      setTick: function (rate, hz) { tickRate = rate; tickHz = hz; },
      setRiser: function (p) {
        const q = Math.max(0, Math.min(1, p));
        ramp(riseGain.gain, Math.pow(q, 1.6) * SND.riser, 0.1);
        ramp(riseA.frequency, 55 * (1 + q * 3), 0.1);
        ramp(riseB.frequency, 55.5 * (1 + q * 3), 0.1);
        ramp(riseLP.frequency, 150 + q * q * 2400, 0.1);
      },

      chime: function (f, vol, delay) {
        tone(f, { bell: true, gain: SND.chime * (vol == null ? 1 : vol), att: 0.008, dur: 2.6, delay: delay || 0 });
      },
      note: function (f) { tone(f, { type: 'triangle', gain: 0.055, att: 0.01, dur: 0.9 }); },
      dull: function (f, delay) { tone(f * 0.5, { gain: 0.05, att: 0.01, dur: 0.35, wet: false, delay: delay || 0 }); },
      pop: function () { tone(1800, { gain: 0.03, att: 0.001, dur: 0.05, wet: false }); },
      confirm: function () { api.chime(440, 1, 0); api.chime(659.25, 0.8, 0.09); },
      milestone: function (i) { api.chime([293.66, 440, 587.33, 880][i] || 440, 1.1, 0); },
      eight: function () {
        PENT_LO.forEach(function (f, i) { api.chime(f, 0.75, i * 0.15); });
      },
      glimmer: function () {
        [0, 2, 4, 5, 7].forEach(function (k, i) { api.chime(PENT_HI[k], 0.5, i * 0.12); });
      },

      impact: function () {
        if (dead || !running()) return;
        const t = ac.currentTime;
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(96, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.7);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.4, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        o.connect(g); g.connect(bus); g.connect(send);
        o.start(t); o.stop(t + 2.5);
        o.onended = function () { o.disconnect(); g.disconnect(); };

        const n = ac.createBufferSource();
        n.buffer = noiseBuf;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        const ng = ac.createGain();
        ng.gain.setValueAtTime(0.0001, t);
        ng.gain.linearRampToValueAtTime(0.16, t + 0.01);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        n.connect(lp); lp.connect(ng); ng.connect(bus); ng.connect(send);
        n.start(t, Math.random()); n.stop(t + 0.6);
        n.onended = function () { n.disconnect(); lp.disconnect(); ng.disconnect(); };
      },
      swell: function (secs) {
        if (dead || !running()) return;
        const t = ac.currentTime;
        const n = ac.createBufferSource();
        n.buffer = noiseBuf;
        n.loop = true;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(300, t);
        bp.frequency.exponentialRampToValueAtTime(4000, t + secs);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + secs * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + secs * 1.2);
        n.connect(bp); bp.connect(g); g.connect(bus); g.connect(send);
        n.start(t); n.stop(t + secs * 1.25);
        n.onended = function () { n.disconnect(); bp.disconnect(); g.disconnect(); };
      },

      /* Abrupt silence (Scene 2 freeze) */
      freeze: function () {
        const t = ac.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setTargetAtTime(0, t, 0.006);
        sparkleRate = 0; tickRate = 0;
        api.setRiser(0);
        ramp(riseGain.gain, 0, 0.01);
        ramp(rainGain.gain, 0, 0.01);
        ramp(droneGain.gain, 0, 0.01);
      },
      restore: function (secs) { ramp(bus.gain, 1, secs); },
      fadeOut: function (secs) {
        sparkleRate = 0; tickRate = 0;
        ramp(droneGain.gain, 0, secs);
        ramp(rainGain.gain, 0, secs);
        ramp(riseGain.gain, 0, secs);
      },

      destroy: function () {
        if (dead) return;
        dead = true;
        loopTimers.forEach(function (id) { clearTimeout(id); });
        loopTimers.clear();
        const cleanup = function () {
          try { bus.disconnect(); verb.disconnect(); verbOut.disconnect(); send.disconnect(); } catch (e) { /* ignore */ }
        };
        if (running()) {
          const t = ac.currentTime;
          bus.gain.cancelScheduledValues(t);
          bus.gain.setTargetAtTime(0, t, 0.015);
          longOscs.forEach(function (o, i) {
            try { o.stop(t + 0.1); } catch (e) { /* ignore */ }
            if (i === longOscs.length - 1) o.onended = cleanup;
          });
        } else {
          longOscs.forEach(function (o) { try { o.stop(); } catch (e) { /* ignore */ } });
          cleanup();
        }
      }
    };
    return api;
  }

  /* ========================================================================
     Procedural rain renderer (canvas, one draw pass per frame; no per-glyph
     DOM nodes)
     ====================================================================== */

  function createRain(canvas, initiallyReduced) {
    const g = canvas.getContext && canvas.getContext('2d', { alpha: false });
    if (!g) {
      return { start() {}, stop() {}, resize() {}, setDensity() {}, setSpeed() {}, setReduced() {}, destroy() {} };
    }

    const GLYPHS = Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{};:,.<>/?|~');
    const MONO = 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace';
    const BASE = '#1D512B';
    const HI = '#78B982';

    let w = 0, h = 0, dpr = 1, fs = 16, lh = 19, cw = 15, rows = 0;
    let cols = [];
    let density = 0.45, speed = 1, builtDensity = -1;
    let rafId = 0, last = 0, wantRunning = false;
    let reduced = !!initiallyReduced;

    const rg = function () { return GLYPHS[(Math.random() * GLYPHS.length) | 0]; };
    const effDensity = function () { return reduced ? density * 0.4 : density; };

    function spawn(c, initial) {
      c.state = 'run';
      c.len = 8 + ((Math.random() * 24) | 0);
      c.speed = 6 + Math.random() * 16;          // rows per second
      c.bright = 0.5 + Math.random() * 0.5;
      c.hot = Math.random() < 0.12;
      c.chars = Array.from({ length: c.len }, rg);
      c.head = initial ? Math.random() * (rows + c.len) - c.len * 0.3 : -Math.random() * 4;
    }

    function build() {
      const n = Math.ceil(w / cw);
      cols = [];
      for (let i = 0; i < n; i++) {
        const c = { x: i * cw, thr: Math.random(), state: 'wait', wait: Math.random() * 3,
                    len: 0, speed: 0, bright: 1, hot: false, chars: [], head: 0 };
        if (c.thr <= effDensity()) spawn(c, true);
        cols.push(c);
      }
      builtDensity = density;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(rect.width));
      const nh = Math.max(1, Math.round(rect.height));
      const widthChanged = nw !== w;
      w = nw; h = nh;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      fs = Math.max(13, Math.min(18, Math.round(w / 70)));
      lh = Math.round(fs * 1.2);
      cw = Math.round(fs * 0.95);
      rows = Math.ceil(h / lh) + 1;
      if (widthChanged || !cols.length) build();
      draw();
    }

    function update(dt) {
      const dens = effDensity();
      for (let k = 0; k < cols.length; k++) {
        const c = cols[k];
        if (c.state === 'wait') {
          c.wait -= dt;
          if (c.wait <= 0) {
            if (c.thr <= dens) spawn(c, false);
            else c.wait = 0.4 + Math.random() * 0.6;
          }
          continue;
        }
        const prev = Math.floor(c.head);
        c.head += c.speed * speed * dt;
        const cur = Math.floor(c.head);
        for (let r = prev; r < cur; r++) c.chars.unshift(rg());
        if (c.chars.length > c.len) c.chars.length = c.len;
        if (Math.random() < dt * 3) c.chars[(Math.random() * c.chars.length) | 0] = rg();
        if (c.head - c.len > rows + 1) {
          c.state = 'wait';
          c.wait = Math.random() * (0.2 + 6 * (1 - dens));
        }
      }
    }

    function draw() {
      g.globalAlpha = 1;
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, h);
      g.font = fs + 'px ' + MONO;
      g.textBaseline = 'top';
      let fill = '';
      for (let k = 0; k < cols.length; k++) {
        const c = cols[k];
        if (c.state !== 'run') continue;
        const hr = Math.floor(c.head);
        for (let i = 0; i < c.chars.length; i++) {
          const row = hr - i;
          if (row < 0 || row >= rows) continue;
          const ch = c.chars[i];
          const t = i / c.len;
          let a = Math.pow(1 - t, 1.5) * c.bright;
          let col = BASE;
          if (i === 0) { col = HI; a = c.hot ? 1 : 0.2 + 0.55 * c.bright; }
          else if (i === 1 && c.hot) { col = HI; a = 0.55; }
          else if (((row * 7 + ch.charCodeAt(0) + (c.x | 0)) % 29) === 0) { col = HI; a = 0.1 + 0.5 * (1 - t); }
          if (a < 0.04) continue;
          if (col !== fill) { g.fillStyle = col; fill = col; }
          g.globalAlpha = a > 1 ? 1 : a;
          g.fillText(ch, c.x, row * lh);
        }
      }
      g.globalAlpha = 1;
    }

    function loop(now) {
      rafId = requestAnimationFrame(loop);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      update(dt);
      draw();
    }

    function stopLoop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    resize();

    return {
      start() {
        wantRunning = true;
        if (reduced) { draw(); return; }
        if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(loop); }
      },
      stop() { wantRunning = false; stopLoop(); },
      resize: resize,
      setDensity(d) {
        density = d;
        if (reduced && Math.abs(density - builtDensity) > 0.15) { build(); draw(); }
      },
      setSpeed(s) { speed = s; },
      setReduced(v) {
        const was = wantRunning;
        stopLoop();
        reduced = !!v;
        build();
        draw();
        if (was && !reduced) { last = performance.now(); rafId = requestAnimationFrame(loop); }
      },
      destroy() { wantRunning = false; stopLoop(); cols = []; }
    };
  }

  /* ========================================================================
     Act session
     ====================================================================== */

  function run(ctx) {
    const root = ctx.root;
    const motion = ctx.motion;
    const fmt = new Intl.NumberFormat('en-US');
    const snd = createSound(ctx.audio);

    const timers = new Set();
    const rafs = new Set();
    const undo = [];

    const FADE = function () { return motion.reduced() ? 0 : 1200; };

    /* ---- Lifecycle-safe helpers ---- */

    const sleep = function (ms) {
      return new Promise(function (resolve) {
        const id = setTimeout(function () { timers.delete(id); resolve(); }, ms);
        timers.add(id);
      });
    };
    const later = function (fn, ms) {
      const id = setTimeout(function () { timers.delete(id); fn(); }, ms);
      timers.add(id);
    };
    const tween = function (ms, fn) {
      return new Promise(function (resolve) {
        const t0 = performance.now();
        let id = 0;
        const frame = function (now) {
          rafs.delete(id);
          const p = Math.min(1, Math.max(0, (now - t0) / ms));
          fn(p);
          if (p < 1) { id = requestAnimationFrame(frame); rafs.add(id); }
          else resolve();
        };
        id = requestAnimationFrame(frame);
        rafs.add(id);
      });
    };
    const on = function (target, type, handler, opts) {
      target.addEventListener(type, handler, opts);
      let removed = false;
      const off = function () {
        if (removed) return;
        removed = true;
        target.removeEventListener(type, handler, opts);
      };
      undo.push(off);
      return off;
    };

    /* ---- DOM helpers ---- */

    const el = function (tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const svgEl = function (tag) { return document.createElementNS(SVG_NS, tag); };
    const slide = function (content) {
      const s = el('div', 'a1-slide');
      const inner = el('div', 'a1-slide-in');
      content.classList.add('a1-pad');
      inner.appendChild(content);
      s.appendChild(inner);
      return s;
    };
    const open = function (n) { n.classList.add('is-on'); };
    const close = function (n) { n.classList.remove('is-on'); };
    const bring = function (n) {
      try { n.scrollIntoView({ block: 'nearest', behavior: motion.reduced() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
    };

    async function showSec(sec) {
      sec.hidden = false;
      void sec.offsetWidth;
      sec.classList.add('is-on');
      await sleep(FADE());
    }
    async function hideSec(sec) {
      sec.classList.remove('is-on');
      await sleep(FADE());
      sec.hidden = true;
    }

    function makeMemory() {
      const wrap = el('div', 'a1-memory-wrap');
      const box = el('div', 'a1-memory');
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label',
        'Illustration: a small container with eight empty slots, representing limited memory. ' +
        'It is a metaphor only, not the storage structure of any specific algorithm.');
      for (let i = 0; i < 8; i++) box.appendChild(el('span', 'a1-slot'));
      const cap = el('p', 'a1-cap', 'Limited memory \u00B7 illustration');
      cap.setAttribute('aria-hidden', 'true');
      wrap.append(box, cap);
      return wrap;
    }

    /* ---- Build DOM ---- */

    root.classList.add('a1');

    const canvas = el('canvas', 'a1-rain');
    canvas.setAttribute('aria-hidden', 'true');
    const veil = el('div', 'a1-veil');
    veil.setAttribute('aria-hidden', 'true');

    // Section A: scenes 1 and 2 (rain + counter)
    const secA = el('section', 'a1-sec a1-secA');
    secA.hidden = true;
    const hA = el('h2', 'sr-only', 'Scene 1 of 4: The rain');
    const solo = el('p', 'a1-line a1-line--solo');
    solo.setAttribute('aria-hidden', 'true');
    const stackA = el('div', 'a1-stack');

    const counterWrap = el('div', 'a1-counter a1-fade');
    counterWrap.setAttribute('aria-hidden', 'true');
    const numEl = el('p', 'a1-num', '0');
    const statusEl = el('p', 'a1-status', 'AND STILL COUNTING...');
    counterWrap.append(el('p', 'a1-label', 'ELEMENTS PROCESSED'), numEl, statusEl);

    const s2a = el('p', 'a1-line', COPY.s2[0]);
    const s2b = el('p', 'a1-line', COPY.s2[1]);
    const s2aSlide = slide(s2a);
    const s2bSlide = slide(s2b);

    const memA = makeMemory();
    const memASlide = slide(memA);

    const qWrap = el('div');
    qWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:1.5rem';
    const s2q = el('p', 'a1-q', COPY.s2q);
    const findBtn = el('button', 'a1-btn', 'FIND A WAY');
    findBtn.type = 'button';
    qWrap.append(s2q, findBtn);
    const qSlide = slide(qWrap);

    stackA.append(counterWrap, s2aSlide, s2bSlide, memASlide, qSlide);
    secA.append(hA, solo, stackA);

    // Section B: scene 3
    const secB = el('section', 'a1-sec a1-secB');
    secB.hidden = true;
    const hB = el('h2', 'sr-only', 'Scene 3 of 4: The question');
    const stackB = el('div', 'a1-stack');
    stackB.appendChild(el('p', 'a1-kicker', 'A small illustrative stream'));

    const streamWrap = el('div', 'a1-stream-wrap');
    const arcsSvg = svgEl('svg');
    arcsSvg.setAttribute('class', 'a1-arcs');
    arcsSvg.setAttribute('aria-hidden', 'true');
    const streamOl = el('ol', 'a1-stream');
    streamOl.setAttribute('aria-label', 'Stream of eight arrivals, in order: ' + STREAM.join(', '));
    const tiles = STREAM.map(function (v, i) {
      const li = el('li', 'a1-tile');
      const box = el('span', 'a1-tile-box', v);
      box.setAttribute('aria-hidden', 'true');
      const idx = el('span', 'a1-tile-idx', String(i + 1));
      idx.setAttribute('aria-hidden', 'true');
      const tag = el('span', 'a1-tile-tag', '');
      tag.setAttribute('aria-hidden', 'true');
      const sr = el('span', 'sr-only', 'Arrival ' + (i + 1) + ': ' + v + '.');
      li.append(box, idx, tag, sr);
      streamOl.appendChild(li);
      return { li: li, tag: tag, sr: sr };
    });
    streamWrap.append(arcsSvg, streamOl);

    const form = el('form', 'a1-form');
    form.noValidate = true;
    const fieldset = el('fieldset');
    const legend = el('legend', 'a1-q', COPY.s3q);
    const opts = el('div', 'a1-opts');
    const OPTIONS = [
      { id: 'every_arrival', label: 'Every arrival' },
      { id: 'different_elements', label: 'Only different elements' }
    ];
    const optLabels = OPTIONS.map(function (o) {
      const label = el('label', 'a1-opt');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'a1-interpretation';
      input.value = o.id;
      label.append(input, el('span', null, o.label));
      opts.appendChild(label);
      return label;
    });
    fieldset.append(legend, opts);
    const submitBtn = el('button', 'a1-btn', 'SUBMIT');
    submitBtn.type = 'submit';
    submitBtn.disabled = true;
    form.append(fieldset, submitBtn);
    const formSlide = slide(form);

    const result = el('div');
    result.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%';
    const picked = el('p', 'a1-picked a1-fade');
    const counts = el('dl', 'a1-counts');
    const total = STREAM.length;
    const distinctN = new Set(STREAM).size;
    const repeatsN = total - distinctN;
    const COUNT_DEFS = [
      { key: 'every_arrival', n: total, label: 'Arrivals' },
      { key: 'different_elements', n: distinctN, label: 'Distinct elements' },
      { key: null, n: repeatsN, label: 'Repeated arrivals' }
    ];
    const countEls = COUNT_DEFS.map(function (d) {
      const box = el('div', 'a1-count a1-fade');
      const dt = el('dt', null, d.label);
      const dd = el('dd', null, String(d.n));
      box.append(dt, dd);
      counts.appendChild(box);
      return { box: box, dt: dt, def: d };
    });
    const explain = el('div', 'a1-explain');
    const explEls = COPY.s3expl.map(function (t, i) {
      const p = el('p', 'a1-expl a1-fade' + (i === 2 ? ' a1-expl--key' : ''), t);
      explain.appendChild(p);
      return p;
    });
    result.append(picked, counts, explain);
    const resultSlide = slide(result);

    stackB.append(streamWrap, formSlide, resultSlide);
    secB.append(hB, stackB);

    // Section C: scene 4
    const secC = el('section', 'a1-sec a1-secC');
    secC.hidden = true;
    const hC = el('h2', 'sr-only', 'Scene 4 of 4: The constraint');
    const stackC = el('div', 'a1-stack');

    const memC = makeMemory();
    const memCSlide = slide(memC);
    const s4Slides = COPY.s4lines.map(function (t) { return slide(el('p', 'a1-s4line', t)); });

    const chWrap = el('div');
    chWrap.append(el('p', 'a1-challenge', COPY.s4challenge));
    const chSlide = slide(chWrap);
    const supSlide = slide(el('p', 'a1-support', COPY.s4support));

    const formal = el('div', 'a1-formal');
    formal.innerHTML =
      '<div class="a1-formal-row"><p class="a1-formal-label">The stream</p>' +
      '<math display="block"><mrow><mi>S</mi><mo>=</mo><mo>(</mo>' +
      '<msub><mi>a</mi><mn>1</mn></msub><mo>,</mo><msub><mi>a</mi><mn>2</mn></msub><mo>,</mo>' +
      '<mo>\u2026</mo><mo>,</mo><msub><mi>a</mi><mi>n</mi></msub><mo>)</mo></mrow></math></div>' +
      '<div class="a1-formal-row"><p class="a1-formal-label">Distinct elements</p>' +
      '<math display="block"><mrow><mi>d</mi><mo>=</mo><mo>|</mo><mo>{</mo>' +
      '<msub><mi>a</mi><mi>i</mi></msub><mo>:</mo><mn>1</mn><mo>\u2264</mo><mi>i</mi><mo>\u2264</mo><mi>n</mi>' +
      '<mo>}</mo><mo>|</mo></mrow></math>' +
      '<p class="a1-formal-note">n is the number of arrivals so far; d counts each distinct value once.</p></div>' +
      '<div class="a1-formal-row"><p class="a1-formal-label">Objective</p>' +
      '<p>Estimate d using memory substantially smaller than that required to store the entire stream.</p></div>';
    const formalSlide = slide(formal);

    const closeWrap = el('div');
    const close1 = el('p', 'a1-closing-1 a1-fade', COPY.closing);
    closeWrap.append(close1);
    const closeSlide = slide(closeWrap);

    stackC.append(memCSlide, s4Slides[0], s4Slides[1], s4Slides[2], chSlide, supSlide, formalSlide, closeSlide);
    secC.append(hC, stackC);

    // Continue cue (visual) + live-region announcement (assistive tech)
    const hint = el('div', 'a1-hint');
    hint.setAttribute('aria-hidden', 'true');
    hint.appendChild(el('span', null, COPY.gate));
    const gateLive = el('p', 'sr-only');
    gateLive.setAttribute('role', 'status');

    root.append(canvas, veil, secA, secB, secC, hint, gateLive);

    /* ---- Click / key gate: a screen that waits for the visitor ---- */

    function gate() {
      return new Promise(function (resolve) {
        let armed = false, done = false;
        const offs = [];

        sleep(1200).then(function () {
          if (done) return;
          armed = true;
          hint.classList.add('is-on');
          gateLive.textContent = 'Click or press Enter to continue.';
        });

        function finish() {
          if (done || !armed) return;
          done = true;
          offs.forEach(function (f) { f(); });
          hint.classList.remove('is-on');
          gateLive.textContent = '';
          snd.pop();
          resolve();
        }

        offs.push(on(root, 'click', function (e) {
          if (e.target.closest && e.target.closest('button, input, label, a')) return;
          finish();
        }));
        offs.push(on(document, 'keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowRight') return;
          const t = e.target;
          if (t && t.closest && t.closest('button, input, a, textarea, select')) return;
          e.preventDefault();
          finish();
        }));
      });
    }

    /* ---- Rain + resize + reduced motion ---- */

    const rain = createRain(canvas, motion.reduced());

    let arcPairs = [];
    let arcsDrawn = false;
    let resizeRaf = 0;
    on(window, 'resize', function () {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function () {
        rafs.delete(resizeRaf);
        resizeRaf = 0;
        rain.resize();
        if (arcsDrawn) drawArcs();
      });
      rafs.add(resizeRaf);
    });
    undo.push(motion.subscribe(function (r) { rain.setReduced(r); }));

    /* ---- Counter ---- */

    let counterValue = 0;
    function setCounter(v) {
      const nv = Math.max(counterValue, Math.floor(v));
      counterValue = nv;
      numEl.textContent = fmt.format(nv);
    }
    const tickPitch = function () { return 220 * Math.pow(2, Math.log10(counterValue + 10) / 3.2); };
    function flash() {
      numEl.classList.add('is-flash');
      later(function () { numEl.classList.remove('is-flash'); }, 900);
    }

    /* ---- Scene 1: THE RAIN ---- */

    async function scene1() {
      secA.hidden = false;
      secA.classList.add('is-on');
      rain.setDensity(0.45);
      rain.setSpeed(1);
      rain.start();

      snd.setMood('rain', 0.1);
      snd.setDrone(0.7, 8);
      snd.setRain(0.6, 5);
      snd.setSparkle(2.2);

      await sleep(5000); // rain only
      if (ctx.audio && ctx.audio.revealToggle) ctx.audio.revealToggle();
      await sleep(1200);

      ctx.announce('Act I, scene 1: The rain. ' + COPY.s1.join(' '));
      const NOTES = [293.66, 329.63, 369.99, 440.0];
      for (let i = 0; i < COPY.s1.length; i++) {
        solo.textContent = COPY.s1[i];
        solo.classList.add('is-on');
        snd.chime(NOTES[i], 0.85);
        await sleep(2900);              // 0.7 in + 2.2 hold
        solo.classList.remove('is-on');
        await sleep(800);               // 0.7 out
      }

      open(counterWrap);
      ctx.announce('An illustrative counter of total arrivals, not distinct elements, begins counting upward.');
      await tween(10000, function (p) {
        setCounter(90 * Math.pow(p * 8, 2.1));   // accelerating, ends near 7,092
        snd.setTick(1.5 + 9 * p * p, tickPitch());
        snd.setDrone(0.7 + 0.3 * p, 0.2);
      });
    }

    /* ---- Scene 2: THE IMPOSSIBLE DEMAND ---- */

    async function scene2() {
      hA.textContent = 'Scene 2 of 4: The impossible demand';
      ctx.announce('Scene 2: The impossible demand. The count keeps accelerating.');
      numEl.classList.add('is-prominent');

      const v0 = Math.max(1, counterValue);
      const T = 14000;
      const k = Math.log(1e9 / v0) / (T / 1000);
      const crossed = new Set();
      rain.setDensity(0.55);

      await tween(T, function (p) {
        const v = p >= 1 ? 1e9 : Math.min(1e9, Math.round(v0 * Math.exp(k * p * T / 1000)));
        setCounter(v);
        for (let i = 0; i < MILESTONES.length; i++) {
          const m = MILESTONES[i];
          if (!crossed.has(m) && counterValue >= m) {
            crossed.add(m);
            flash();
            if (i < 3) snd.milestone(i);
          }
        }
        rain.setDensity(0.55 + 0.45 * p);
        rain.setSpeed(1 + 1.4 * p);
        snd.setRain(0.6 + 0.4 * p, 0.2);
        snd.setSparkle(2.2 + 3 * p);
        snd.setTick(9 * Math.pow(5.5, p), tickPitch());
        snd.setRiser(p);
      });

      // Abrupt freeze at exactly one billion
      rain.stop();
      snd.freeze();
      setCounter(1e9);
      counterWrap.classList.add('is-frozen');
      statusEl.classList.add('is-off');
      await sleep(2000);                // held silence

      snd.setMood('calm', 5);
      snd.setDrone(0.75, 4);
      snd.restore(4);

      ctx.announce('The counter has frozen at 1,000,000,000 total arrivals. ' + COPY.s2.join(' '));
      open(s2aSlide);
      snd.chime(293.66, 0.9);
      await sleep(FADE() + 2200);
      open(s2bSlide);
      snd.chime(220.0, 0.9);
      await sleep(FADE() + 1400);

      await gate();                     // click to continue

      open(memASlide);
      open(memA);
      snd.eight();
      await sleep(FADE() + 2200);

      ctx.announce('A container with eight empty slots appears, illustrating limited memory. ' + COPY.s2q);
      open(qSlide);
      snd.chime(220.0, 0.8);
      snd.chime(329.63, 0.6, 0.12);
      findBtn.focus({ preventScroll: true });

      await new Promise(function (resolve) {
        on(findBtn, 'click', function () { findBtn.disabled = true; resolve(); }, { once: true });
      });

      // Leave Scene 2: fade rain out
      snd.confirm();
      snd.setRain(0, 2.5);
      snd.setSparkle(0);
      snd.setTick(0, 300);
      canvas.classList.add('is-off');
      await hideSec(secA);
      rain.stop();
    }

    /* ---- Scene 3: THE QUESTION ---- */

    function drawArcs() {
      if (!arcPairs.length) return;
      const wdt = streamOl.clientWidth;
      arcsSvg.setAttribute('viewBox', '0 0 ' + wdt + ' ' + ARC_H);
      arcsSvg.setAttribute('width', String(wdt));
      arcsSvg.setAttribute('height', String(ARC_H));
      while (arcsSvg.firstChild) arcsSvg.removeChild(arcsSvg.firstChild);
      arcPairs.forEach(function (pair) {
        const a = tiles[pair[0]].li, b = tiles[pair[1]].li;
        const xa = a.offsetLeft + a.offsetWidth / 2;
        const xb = b.offsetLeft + b.offsetWidth / 2;
        const ph = 10 + 9 * (pair[1] - pair[0]);
        const path = svgEl('path');
        path.setAttribute('class', 'a1-arc');
        path.setAttribute('d', 'M ' + xa + ' ' + ARC_H + ' Q ' + ((xa + xb) / 2) + ' ' + (ARC_H - 2 * ph) + ' ' + xb + ' ' + ARC_H);
        const dot = svgEl('circle');
        dot.setAttribute('class', 'a1-arc-dot');
        dot.setAttribute('cx', String(xb));
        dot.setAttribute('cy', String(ARC_H));
        dot.setAttribute('r', '2.5');
        arcsSvg.append(path, dot);
      });
      arcsDrawn = true;
    }

    function encodeStream() {
      const seen = new Map();
      arcPairs = [];
      STREAM.forEach(function (v, i) {
        const t = tiles[i];
        if (!seen.has(v)) {
          seen.set(v, i);
          t.li.classList.add('is-first');
          t.tag.textContent = '+1';
          t.sr.textContent = 'Arrival ' + (i + 1) + ': ' + v + '. First appearance of this value; adds one to the distinct count.';
          snd.chime(LETTER_HZ[v], 0.7, i * 0.13);        // bright: something new
        } else {
          t.li.classList.add('is-repeat');
          t.tag.textContent = '+0';
          t.sr.textContent = 'Arrival ' + (i + 1) + ': ' + v + '. Repeat of arrival ' + (seen.get(v) + 1) + '; does not change the distinct count.';
          arcPairs.push([seen.get(v), i]);
          snd.dull(LETTER_HZ[v], i * 0.13);              // dull: nothing new
        }
        t.tag.classList.add('is-on');
      });
      drawArcs();
      void arcsSvg.getBoundingClientRect();
      arcsSvg.classList.add('is-on');
    }

    async function scene3() {
      ctx.announce('Scene 3: The question. A small stream of eight arrivals appears, in order: ' + STREAM.join(', ') + '.');
      snd.setMood('calm', 3);
      snd.setDrone(0.5, 3);
      await showSec(secB);
      await sleep(800);

      for (let i = 0; i < tiles.length; i++) {
        tiles[i].li.classList.add('is-on');
        snd.note(LETTER_HZ[STREAM[i]]);
        await sleep(900);
      }
      await sleep(2500);               // let the stream sink in

      ctx.announce(COPY.s3q + ' Choose one interpretation, then submit.');
      open(formSlide);
      snd.chime(220.0, 0.7);

      on(form, 'change', function () {
        const sel = form.querySelector('input:checked');
        submitBtn.disabled = !sel;
        optLabels.forEach(function (l) { l.classList.toggle('is-checked', l.querySelector('input').checked); });
        snd.pop();
      });

      const choice = await new Promise(function (resolve) {
        on(form, 'submit', function (e) {
          e.preventDefault();
          const sel = form.querySelector('input:checked');
          if (!sel || submitBtn.disabled) return;
          submitBtn.disabled = true;
          fieldset.disabled = true;
          resolve(sel.value);
        });
      });

      // Reveal
      snd.confirm();
      close(formSlide);
      await sleep(FADE());

      encodeStream();
      await sleep(1200);

      const pickedText = choice === 'every_arrival'
        ? 'Counting every arrival gives ' + total + '.'
        : 'Counting only different elements gives ' + distinctN + '.';
      picked.textContent = pickedText;
      countEls.forEach(function (c) {
        if (c.def.key === choice) {
          c.box.classList.add('is-mine');
          c.dt.appendChild(document.createTextNode(' '));
          c.dt.appendChild(el('span', 'a1-mine', '\u00B7 your count'));
        }
      });

      open(resultSlide);
      open(picked);
      await sleep(FADE() + 800);
      const COUNT_HZ = [293.66, 440.0, 587.33];
      for (let i = 0; i < countEls.length; i++) {
        open(countEls[i].box);
        snd.chime(COUNT_HZ[i], 0.9);
        await sleep(1200);
      }

      ctx.announce(pickedText + ' There are ' + total + ' arrivals, ' + distinctN +
        ' distinct elements and ' + repeatsN + ' repeated arrivals. ' + COPY.s3expl.join(' '));
      await sleep(1000);
      for (let i = 0; i < explEls.length; i++) {
        open(explEls[i]);
        if (i === 2) { snd.chime(440, 0.9); snd.chime(659.25, 0.7, 0.1); }
        else snd.chime(i === 0 ? 220.0 : 246.94, 0.7);
        await sleep(FADE() + 2600);
      }

      await gate();                    // click to continue
      await hideSec(secB);
      arcsDrawn = false;
    }

    /* ---- Scene 4: THE CONSTRAINT ---- */

    async function scene4() {
      ctx.announce('Scene 4: The constraint. ' + COPY.s4lines.join(' '));
      canvas.classList.remove('is-off');
      canvas.classList.add('is-subdued');
      veil.classList.add('is-on');
      rain.setDensity(0.4);
      rain.setSpeed(0.8);
      rain.start();

      snd.setMood('warm', 5);
      snd.setDrone(0.85, 5);
      snd.setRain(0.3, 4);
      snd.setSparkle(1.2);

      await showSec(secC);
      open(memCSlide);
      open(memC);
      snd.eight();
      await sleep(FADE() + 1800);

      const LINE_HZ = [293.66, 246.94, 220.0];
      for (let i = 0; i < s4Slides.length; i++) {
        open(s4Slides[i]);
        snd.chime(LINE_HZ[i], 0.85);
        await sleep(FADE() + 2200);
      }
      await sleep(800);

      await gate();                    // click to continue

      ctx.announce(COPY.s4challenge + ' ' + COPY.s4support);
      open(chSlide);
      snd.swell(2.6);
      snd.chime(293.66, 1, 1.8);
      snd.chime(440.0, 0.8, 1.9);
      snd.chime(739.99, 0.6, 2.0);
      await sleep(FADE());
      bring(chSlide);
      await sleep(2400);
      open(supSlide);
      await sleep(FADE() + 2600);
      bring(supSlide);

      ctx.announce('Formal statement. The stream is S equals the sequence a sub 1 through a sub n. ' +
        'The number of distinct elements is d, the size of the set of all a sub i for i from 1 to n. ' +
        'The objective is to estimate d using memory substantially smaller than that required to store the entire stream.');
      open(formalSlide);
      snd.glimmer();
      await sleep(FADE());
      bring(formalSlide);
      await sleep(3000);

      await gate();                    // click to continue

      // Closing: slow the rain, remove container and supporting material
      snd.setRain(0, 9);
      snd.setSparkle(0);
      snd.setMood('low', 10);
      const slowing = tween(9000, function (p) {
        rain.setSpeed(0.8 * (1 - p) + 0.03 * p);
        rain.setDensity(0.4 * (1 - p) + 0.2 * p);
      });
      close(memC);
      close(memCSlide);
      s4Slides.forEach(close);
      close(formalSlide);
      await sleep(FADE() + 3500);       // the central question stands alone

      close(supSlide);
      close(chSlide);
      await sleep(FADE() + 500);

      ctx.announce(COPY.closing);
      open(closeSlide);
      open(close1);
      snd.impact();
      snd.chime(146.83, 1, 0.15);
      await sleep(FADE() + 4500);
      await slowing;

      snd.fadeOut(6);
      await sleep(3500);

      rain.stop();
      ctx.complete();   // handoff: the controller enters the next Act when one exists
    }

    /* ---- Run ---- */

    (async function main() {
      await scene1();
      await scene2();
      await scene3();
      await scene4();
    })().catch(function (err) { console.error('[Act I]', err); });

    /* ---- Destroy: release everything ---- */

    return function destroy() {
      timers.forEach(function (id) { clearTimeout(id); });
      timers.clear();
      rafs.forEach(function (id) { cancelAnimationFrame(id); });
      rafs.clear();
      undo.splice(0).forEach(function (fn) { fn(); });
      snd.destroy();
      rain.destroy();
      root.classList.remove('a1');
      while (root.firstChild) root.removeChild(root.firstChild);
    };
  }

  /* ---- Registration ---- */

  let destroyCurrent = null;

  TTS.registerAct('act1', {
    id: 'act1',
    title: 'THE PROBLEM',
    enter: function (ctx) {
      if (destroyCurrent) destroyCurrent();
      destroyCurrent = run(ctx);
    },
    exit: function () {
      if (destroyCurrent) { destroyCurrent(); destroyCurrent = null; }
    }
  });
})();
