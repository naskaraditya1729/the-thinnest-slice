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
    s3q: 'How many distinct elements have arrived?',
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
    gate: 'CLICK OR PRESS ENTER TO CONTINUE',
    gateTouch: 'TAP TO CONTINUE'
  };

  const STREAM = ['A', 'B', 'A', 'C', 'D', 'B', 'E', 'C'];
  const MILESTONES = [10000, 1000000, 100000000, 1000000000];
  const ARC_H = 56;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const bufferCache = new WeakMap();   // generated audio buffers, per AudioContext

  const isTouch = function () {
    return !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  };

  /* ---- Sound design constants ------------------------------------------- */

  const SND = {
    drone: 0.11,     // ambient bed
    rain: 0.045,     // noise hiss
    sparkle: 0.014,  // glyph shimmer
    tick: 0.02,      // counter ticks
    chime: 0.07,     // bells
    riser: 0.05,     // Scene 2 tension riser
    pulse: 0.3       // heartbeat thump
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
  const SND_API = ['setMood', 'setDrone', 'setRain', 'setSparkle', 'setTick', 'setRiser', 'setPulse',
    'chime', 'note', 'dull', 'pop', 'tap', 'wrong', 'success', 'confirm', 'milestone', 'eight',
    'glimmer', 'whoosh', 'beat', 'swell', 'riseIn', 'boom', 'freeze', 'restore', 'fadeOut', 'destroy'];

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

    /* Generated buffers are built once per AudioContext and reused when the
       Act is re-entered. */
    let cache = bufferCache.get(ac);
    if (!cache) { cache = {}; bufferCache.set(ac, cache); }

    /* Reverb (generated impulse response). The decay envelope is evaluated
       every 128 samples and interpolated, which keeps this off the critical
       path on slow phones. */
    function impulse(len, decay) {
      const n = Math.floor(ac.sampleRate * len);
      const b = ac.createBuffer(2, n, ac.sampleRate);
      const STEP = 128;
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < n; i += STEP) {
          const e0 = Math.pow(1 - i / n, decay);
          const e1 = Math.pow(Math.max(0, 1 - (i + STEP) / n), decay);
          const end = Math.min(n, i + STEP);
          for (let j = i; j < end; j++) d[j] = (Math.random() * 2 - 1) * (e0 + (e1 - e0) * ((j - i) / STEP));
        }
      }
      return b;
    }
    const verb = ac.createConvolver();
    verb.buffer = cache.ir || (cache.ir = impulse(3.4, 2.6));
    const verbOut = ac.createGain();
    verbOut.gain.value = 0.7;
    verb.connect(verbOut);
    verbOut.connect(bus);
    const send = ac.createGain();
    send.gain.value = 1;
    send.connect(verb);

    /* Shared noise buffer */
    const noiseBuf = cache.noise || (cache.noise = (function () {
      const n = ac.sampleRate * 2;
      const b = ac.createBuffer(1, n, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })());

    /* Smooth parameter glide. The value is anchored at "now" first, so a new
       target never causes a jump (older Safari / Firefox need the anchor). */
    const ramp = function (param, v, secs) {
      const t = ac.currentTime;
      if (param.cancelAndHoldAtTime) {
        param.cancelAndHoldAtTime(t);
      } else {
        const cur = param.value;
        param.cancelScheduledValues(t);
        param.setValueAtTime(cur, t);
      }
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

    /* Event lanes (counter ticks, glyph sparkle, heartbeat). A short
       look-ahead scheduler places every event on the audio clock, so the
       spacing stays even when the main thread is busy with layout or paint. */
    let dead = false;
    let sparkleRate = 0, tickRate = 0, tickHz = 300, pulseRate = 0;
    let voices = 0;
    const LOOK_AHEAD = 0.16, SCHED_MS = 25, MAX_AMBIENT = 26;
    const BELL = [[1, 1], [2.76, 0.22], [5.4, 0.08]];
    const SINGLE = [[1, 1]];
    const lanes = [];
    let schedTimer = 0;

    function lane(getRate, fn, steady) { lanes.push({ rate: getRate, fn: fn, steady: !!steady, next: 0 }); }
    function gapOf(L, base) { return L.steady ? base : base * (0.6 + Math.random() * 0.8); }

    function schedule() {
      schedTimer = 0;
      if (dead) return;
      if (running()) {
        const now = ac.currentTime, horizon = now + LOOK_AHEAD;
        for (let k = 0; k < lanes.length; k++) {
          const L = lanes[k];
          const r = L.rate();
          if (!(r > 0)) { L.next = 0; continue; }
          const base = 1 / r;
          if (L.next < now) L.next = now + gapOf(L, base);   // (re)seed; never burst after a stall
          while (L.next < horizon) { L.fn(L.next); L.next += gapOf(L, base); }
        }
      }
      schedTimer = setTimeout(schedule, SCHED_MS);
    }

    /* One-shot voice. o.at = absolute audio time, o.delay = seconds from now. */
    function tone(f, o) {
      if (dead || !running()) return;
      o = o || {};
      if (o.amb && voices >= MAX_AMBIENT) return;
      const t = o.at != null ? Math.max(o.at, ac.currentTime) : ac.currentTime + (o.delay || 0);
      const att = o.att == null ? 0.01 : o.att;
      const dur = o.dur || 1;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.gain || 0.05, t + att);
      g.gain.exponentialRampToValueAtTime(0.0001, t + att + dur);
      g.connect(bus);
      if (o.wet !== false) g.connect(send);
      const parts = o.bell ? BELL : SINGLE;
      let left = parts.length;
      voices++;
      parts.forEach(function (p) {
        const osc = ac.createOscillator();
        osc.type = o.type || 'sine';
        osc.frequency.value = f * p[0];
        let pg = null;
        if (p[1] !== 1) {
          pg = ac.createGain();
          pg.gain.value = p[1];
          osc.connect(pg);
          pg.connect(g);
        } else {
          osc.connect(g);
        }
        osc.start(t);
        osc.stop(t + att + dur + 0.05);
        osc.onended = function () {
          osc.disconnect();
          if (pg) pg.disconnect();
          if (--left === 0) { g.disconnect(); voices--; }
        };
      });
    }

    /* Low heartbeat-style thump (sub sine + audible harmonic) */
    function thump(gain, at) {
      if (dead || !running()) return;
      const t = at == null ? ac.currentTime : Math.max(at, ac.currentTime);
      [['sine', 70, 42, 1], ['triangle', 140, 84, 0.35]].forEach(function (v) {
        const o = ac.createOscillator();
        o.type = v[0];
        o.frequency.setValueAtTime(v[1], t);
        o.frequency.exponentialRampToValueAtTime(v[2], t + 0.18);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain * v[3], t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.connect(g);
        g.connect(bus);
        o.start(t);
        o.stop(t + 0.35);
        o.onended = function () { o.disconnect(); g.disconnect(); };
      });
    }

    /* Short filtered noise burst */
    function burst(t, type, freq, gain, dur) {
      const n = ac.createBufferSource();
      n.buffer = noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(f); f.connect(g); g.connect(bus); g.connect(send);
      n.start(t, Math.random());
      n.stop(t + dur + 0.05);
      n.onended = function () { n.disconnect(); f.disconnect(); g.disconnect(); };
    }

    /* One cinematic hit: sub drop + mid thump + crack + body (+ resonant tail) */
    function hit(t, lvl, f0, f1, decay, tail) {
      const sub = ac.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(f0, t);
      sub.frequency.exponentialRampToValueAtTime(f1, t + 0.55);
      const sg = ac.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.6 * lvl, t + 0.004);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      sub.connect(sg); sg.connect(bus); sg.connect(send);
      sub.start(t);
      sub.stop(t + decay + 0.05);
      sub.onended = function () { sub.disconnect(); sg.disconnect(); };

      const mid = ac.createOscillator();
      mid.type = 'triangle';
      mid.frequency.setValueAtTime(f0 * 2, t);
      mid.frequency.exponentialRampToValueAtTime(f1 * 2, t + 0.4);
      const mg = ac.createGain();
      mg.gain.setValueAtTime(0.0001, t);
      mg.gain.linearRampToValueAtTime(0.22 * lvl, t + 0.004);
      mg.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.4);
      mid.connect(mg); mg.connect(bus);
      mid.start(t);
      mid.stop(t + decay * 0.4 + 0.05);
      mid.onended = function () { mid.disconnect(); mg.disconnect(); };

      burst(t, 'highpass', 1800, 0.22 * lvl, 0.07);   // sharp crack
      burst(t, 'lowpass', 700, 0.2 * lvl, 0.38);       // body

      if (tail) {
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 2;
        lp.frequency.setValueAtTime(2800, t);
        lp.frequency.exponentialRampToValueAtTime(240, t + 4);
        const tg = ac.createGain();
        tg.gain.setValueAtTime(0.0001, t);
        tg.gain.linearRampToValueAtTime(0.07, t + 0.02);
        tg.gain.exponentialRampToValueAtTime(0.0001, t + 5);
        lp.connect(tg); tg.connect(bus); tg.connect(send);
        const chord = [73.42, 110.0, 146.83, 220.0, 293.66];
        chord.forEach(function (f, i) {
          const o = ac.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f * (i % 2 ? 1.003 : 0.997);
          o.connect(lp);
          o.start(t);
          o.stop(t + 5.1);
          o.onended = function () {
            o.disconnect();
            if (i === chord.length - 1) { lp.disconnect(); tg.disconnect(); }
          };
        });
      }
    }

    lane(function () { return sparkleRate; }, function (t) {
      const f = PENT_HI[(Math.random() * PENT_HI.length) | 0];
      tone(f, { at: t, amb: true, gain: SND.sparkle * (0.5 + Math.random()), att: 0.004, dur: 0.5 + Math.random() * 0.7 });
    });
    lane(function () { return tickRate; }, function (t) {
      tone(tickHz * (1 + Math.random() * 0.02), { at: t, amb: true, type: 'triangle', gain: SND.tick, att: 0.002, dur: 0.03, wet: false });
    });
    lane(function () { return pulseRate; }, function (t) {
      thump(SND.pulse, t);
      thump(SND.pulse * 0.6, t + 0.24);
    }, true);
    schedTimer = setTimeout(schedule, SCHED_MS);

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
      setPulse: function (rate) { pulseRate = rate; },
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
      tap: function () {
        tone(900 + Math.random() * 300, { type: 'triangle', gain: 0.014, att: 0.001, dur: 0.035, wet: false });
      },
      wrong: function () {
        tone(110.0, { type: 'triangle', gain: 0.09, att: 0.004, dur: 0.3, wet: false });
        tone(116.54, { type: 'triangle', gain: 0.07, att: 0.004, dur: 0.3, wet: false });
        thump(0.16);
      },
      success: function () {
        [0, 2, 3, 5, 7].forEach(function (k, i) { api.chime(PENT_HI[k], 0.7, i * 0.09); });
      },
      confirm: function () { api.chime(440, 1, 0); api.chime(659.25, 0.8, 0.09); },
      milestone: function (i) { api.chime([293.66, 440, 587.33, 880][i] || 440, 1.1, 0); },
      eight: function () {
        PENT_LO.forEach(function (f, i) { api.chime(f, 0.75, i * 0.15); });
      },
      glimmer: function () {
        [0, 2, 4, 5, 7].forEach(function (k, i) { api.chime(PENT_HI[k], 0.5, i * 0.12); });
      },
      beat: function () {            // a single "lub-dub"
        thump(SND.pulse);
        thump(SND.pulse * 0.6, ac.currentTime + 0.24);
      },

      /* Filtered-noise sweep between scenes */
      whoosh: function (secs) {
        if (dead || !running()) return;
        secs = secs || 1.6;
        const t = ac.currentTime;
        const n = ac.createBufferSource();
        n.buffer = noiseBuf;
        n.loop = true;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 0.9;
        bp.frequency.setValueAtTime(300, t);
        bp.frequency.exponentialRampToValueAtTime(3500, t + secs);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + secs * 0.45);
        g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
        n.connect(bp); bp.connect(g); g.connect(bus); g.connect(send);
        n.start(t);
        n.stop(t + secs + 0.05);
        n.onended = function () { n.disconnect(); bp.disconnect(); g.disconnect(); };
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
        n.start(t);
        n.stop(t + secs * 1.25);
        n.onended = function () { n.disconnect(); bp.disconnect(); g.disconnect(); };
      },

      /* Reverse-swell that builds, then is cut dead, right before the strike */
      riseIn: function (secs) {
        if (dead || !running()) return;
        const t = ac.currentTime;

        const n = ac.createBufferSource();
        n.buffer = noiseBuf;
        n.loop = true;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(180, t);
        bp.frequency.exponentialRampToValueAtTime(7000, t + secs);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.11, t + secs);
        g.gain.setValueAtTime(0.0001, t + secs + 0.004);
        n.connect(bp); bp.connect(g); g.connect(bus); g.connect(send);
        n.start(t);
        n.stop(t + secs + 0.05);
        n.onended = function () { n.disconnect(); bp.disconnect(); g.disconnect(); };

        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(73.42, t);
        o.frequency.exponentialRampToValueAtTime(293.66, t + secs);
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(400, t);
        lp.frequency.exponentialRampToValueAtTime(2500, t + secs);
        const og = ac.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.035, t + secs);
        og.gain.setValueAtTime(0.0001, t + secs + 0.004);
        o.connect(lp); lp.connect(og); og.connect(bus);
        o.start(t);
        o.stop(t + secs + 0.05);
        o.onended = function () { o.disconnect(); lp.disconnect(); og.disconnect(); };
      },

      /* The strike: a short "ta" hit, then a heavier "DUM" with a resonant tail */
      boom: function () {
        if (dead || !running()) return;
        const t = ac.currentTime + 0.01;
        hit(t, 0.7, 118, 44, 1.6, false);
        hit(t + 0.42, 1, 92, 33, 3.4, true);
        api.chime(293.66, 0.9, 0.43);
      },

      /* Abrupt silence (Scene 2 freeze) */
      freeze: function () {
        const t = ac.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setTargetAtTime(0, t, 0.006);
        sparkleRate = 0; tickRate = 0; pulseRate = 0;
        api.setRiser(0);
        ramp(riseGain.gain, 0, 0.01);
        ramp(rainGain.gain, 0, 0.01);
        ramp(droneGain.gain, 0, 0.01);
      },
      restore: function (secs) { ramp(bus.gain, 1, secs); },
      fadeOut: function (secs) {
        sparkleRate = 0; tickRate = 0; pulseRate = 0;
        ramp(droneGain.gain, 0, secs);
        ramp(rainGain.gain, 0, secs);
        ramp(riseGain.gain, 0, secs);
      },

      destroy: function () {
        if (dead) return;
        dead = true;
        if (schedTimer) { clearTimeout(schedTimer); schedTimer = 0; }
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
     DOM nodes). Glyphs are pre-rendered once into an atlas and blitted with
     drawImage.

     Adaptive density: the amount of rain is derived from the viewport rather
     than from a fixed per-column probability.
       - Glyph size and column pitch scale with the width, so narrow screens
         get more (slightly tighter) columns.
       - The number of simultaneously falling streams follows a compromise
         between "same per pixel" and "same per screen" (width^0.3 below the
         1440px reference), so a phone is no longer sparse.
       - When a narrow screen needs more streams than it has columns, a
         column may carry two streams (same speed, so they never overlap).
       - New streams are placed with best-candidate sampling, which spreads
         them evenly across the width: no permanently empty bands and no
         clusters.
     Streams, ring buffers and fade tables are pooled, so a frame allocates
     nothing. A frame-time governor thins (and later restores) the rain, and
     displays of 100 Hz and above are drawn at half rate.
     ====================================================================== */

  function createRain(canvas, initiallyReduced) {
    const g = canvas.getContext && canvas.getContext('2d', { alpha: false });
    if (!g) {
      return { start() {}, stop() {}, resize() {}, setDensity() {}, setSpeed() {}, setReduced() {}, destroy() {} };
    }

    const GLYPHS = Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{};:,.<>/?|~');
    const GN = GLYPHS.length;
    const MONO = 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace';
    const BASE = '#1D512B';
    const HI = '#78B982';
    const CAP = 32, MASK = 31;          // trail ring buffer (max trail length is 31)
    const REF_W = 1440, REF_COLS = 85;  // the desktop the original density was tuned on
    const SPAWN_TAU = 0.25;             // seconds; how fast missing streams are replaced

    let w = 0, h = 0, dpr = 1, fs = 16, lh = 19, pitch = 15, rows = 0, n = 0, lanes = 1;
    let cols = [];
    const live = [];
    const pool = [];
    let density = 0.45, speed = 1, builtDensity = -1;
    let rafId = 0, last = 0, lastDraw = 0, acc = 0, wantRunning = false;
    let reduced = !!initiallyReduced;

    // glyph atlas
    let atlas = null, atlasKey = '', cellW = 0, cellH = 0, dw = 0, dh = 0;

    // frame governor
    let quality = 1, rateEma = 1 / 60, lastAdjust = 0, slowAt = 0, halfRate = false;

    const rg = function () { return (Math.random() * GN) | 0; };

    /* Number of streams that should be falling right now. */
    function targetActive() {
      const d = reduced ? density * 0.4 : density;
      const f0 = d * (0.55 + 0.45 * d);                 // the original coverage curve
      let s = w >= REF_W ? f0 * n : f0 * REF_COLS * Math.pow(w / REF_W, 0.3);
      s *= Math.min(1, Math.max(0.75, rows / 30));       // short (landscape) screens need less
      return Math.min(s * 1.1, n * lanes * 0.98) * quality;   // 1.1: streams are replaced slightly after they end
    }

    function buildAtlas() {
      const key = fs + '|' + dpr + '|' + lh;
      if (key === atlasKey && atlas) return;
      atlasKey = key;
      const cellCss = Math.ceil(fs * 0.66);
      cellW = Math.ceil(cellCss * dpr);
      cellH = Math.ceil(lh * dpr);
      dw = cellW / dpr;
      dh = cellH / dpr;
      try {
        const a = document.createElement('canvas');
        a.width = cellW * GN;
        a.height = cellH * 2;
        const x = a.getContext('2d');
        if (!x) { atlas = null; return; }
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.font = fs + 'px ' + MONO;
        x.textBaseline = 'top';
        [BASE, HI].forEach(function (color, r) {
          x.fillStyle = color;
          for (let i = 0; i < GN; i++) x.fillText(GLYPHS[i], i * dw, r * dh);
        });
        atlas = a;
      } catch (e) {
        atlas = null;
      }
    }

    function newest(c) {
      const a = c.st;
      return a.length > 1 && a[1].head < a[0].head ? a[1] : a[0];
    }

    function launch(c, head) {
      const s = pool.pop() || { col: null, head: 0, len: 0, speed: 0, bright: 1, hot: false, top: 0,
                                buf: new Uint8Array(CAP), fade: new Float32Array(CAP) };
      const lead = c.st.length ? c.st[c.st.length - 1] : null;
      s.col = c;
      s.len = 8 + ((Math.random() * 24) | 0);
      s.speed = lead ? lead.speed : 6 + Math.random() * 16;   // rows per second
      s.bright = 0.5 + Math.random() * 0.5;
      s.hot = Math.random() < 0.12;
      s.top = 0;
      s.head = head;
      for (let i = 0; i < s.len; i++) {
        s.buf[i] = rg();
        s.fade[i] = Math.pow(1 - i / s.len, 1.5) * s.bright;
      }
      c.st.push(s);
      live.push(s);
      return s;
    }

    function retire(i) {
      const s = live[i];
      const st = s.col.st;
      st.splice(st.indexOf(s), 1);
      live[i] = live[live.length - 1];
      live.pop();
      s.col = null;
      if (pool.length < 160) pool.push(s);
    }

    /* Best-candidate sampling: of a few random free columns, take the one
       farthest from any occupied column. */
    function pickColumn(initial) {
      let best = null, bestScore = -1, found = 0;
      for (let k = 0; k < 16 && found < 3; k++) {
        const c = cols[(Math.random() * n) | 0];
        const m = c.st.length;
        if (m >= lanes) continue;
        if (m && !initial) { const nw = newest(c); if (nw.head - nw.len <= 4) continue; }
        found++;
        let score;
        if (m) score = 0.5;
        else {
          let dist = 7;
          for (let o = 1; o <= 6; o++) {
            const a = cols[c.ci - o], b = cols[c.ci + o];
            if ((a && a.st.length) || (b && b.st.length)) { dist = o; break; }
          }
          score = dist;
        }
        score += Math.random() * 0.4;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best;
    }

    function initialHead(s, c) {
      if (c.st.length < 2) return Math.random() * (rows + s.len) - s.len * 0.3;
      const o = c.st[0];
      const below = o.head + s.len + 3 + Math.random() * 8;
      return below < rows + s.len * 0.5 ? below : o.head - o.len - 3 - Math.random() * 8;
    }

    function build() {
      while (live.length) retire(live.length - 1);
      cols = [];
      for (let i = 0; i < n; i++) cols.push({ x: i * pitch, ci: i, st: [] });
      const A = Math.round(targetActive());
      for (let k = 0; k < A; k++) {
        const c = pickColumn(true);
        if (!c) break;
        const s = launch(c, 0);
        s.head = initialHead(s, c);
      }
      builtDensity = density;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(rect.width));
      const nh = Math.max(1, Math.round(rect.height));
      const ndpr = Math.min(window.devicePixelRatio || 1, 2);
      if (nw === w && nh === h && ndpr === dpr && cols.length) return;
      w = nw; h = nh; dpr = ndpr;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      fs = Math.max(11, Math.min(18, Math.round(w / 70)));
      lh = Math.round(fs * 1.2);
      const pk = Math.max(0.8, Math.min(0.95, 0.8 + (w - 480) / 520 * 0.15));
      const np = Math.max(Math.ceil(fs * 0.66) + 1, Math.round(fs * pk));
      const nn = Math.ceil(w / np);
      rows = Math.ceil(h / lh) + 1;
      buildAtlas();

      if (!cols.length || np !== pitch || nn !== n) {
        pitch = np; n = nn;
        lanes = (w < REF_W && REF_COLS * Math.pow(w / REF_W, 0.3) > n * 1.02) ? 2 : 1;
        build();
      }
      draw();
    }

    function update(dt) {
      const k = speed * dt;
      for (let i = live.length - 1; i >= 0; i--) {
        const s = live[i];
        const prev = Math.floor(s.head);
        s.head += s.speed * k;
        const steps = Math.min(Math.floor(s.head) - prev, CAP);
        for (let r = 0; r < steps; r++) { s.top = (s.top - 1) & MASK; s.buf[s.top] = rg(); }
        if (Math.random() < dt * 3) s.buf[(s.top + ((Math.random() * s.len) | 0)) & MASK] = rg();
        if (s.head - s.len > rows + 1) retire(i);
      }

      const deficit = targetActive() - live.length;
      if (deficit > 0) {
        const want = deficit * dt / SPAWN_TAU;
        let cnt = Math.floor(want);
        if (Math.random() < want - cnt) cnt++;
        while (cnt-- > 0) {
          const c = pickColumn(false);
          if (!c) break;
          launch(c, -Math.random() * 4);
        }
      }
    }

    function draw() {
      g.globalAlpha = 1;
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, h);
      const useAtlas = !!atlas;
      if (!useAtlas) {
        g.font = fs + 'px ' + MONO;
        g.textBaseline = 'top';
      }
      let fill = '';
      for (let k = 0; k < live.length; k++) {
        const s = live[k];
        const c = s.col;
        const hr = Math.floor(s.head);
        const i0 = Math.max(0, hr - (rows - 1));
        const i1 = Math.min(s.len - 1, hr);
        for (let i = i0; i <= i1; i++) {
          const row = hr - i;
          const ch = s.buf[(s.top + i) & MASK];
          let a = s.fade[i];
          let hi = false;
          if (i === 0) { hi = true; a = s.hot ? 1 : 0.2 + 0.55 * s.bright; }
          else if (i === 1 && s.hot) { hi = true; a = 0.55; }
          else if (((row * 7 + ch + c.ci * 5) % 29) === 0) { hi = true; a = 0.1 + 0.5 * (1 - i / s.len); }
          if (a < 0.04) continue;
          g.globalAlpha = a > 1 ? 1 : a;
          if (useAtlas) {
            g.drawImage(atlas, ch * cellW, hi ? cellH : 0, cellW, cellH, c.x, row * lh, dw, dh);
          } else {
            const col = hi ? HI : BASE;
            if (col !== fill) { g.fillStyle = col; fill = col; }
            g.fillText(GLYPHS[ch], c.x, row * lh);
          }
        }
      }
      g.globalAlpha = 1;
    }

    function loop(now) {
      rafId = requestAnimationFrame(loop);
      const raw = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      acc += raw;

      if (raw > 0 && raw < 0.09) {
        rateEma = rateEma * 0.9 + raw * 0.1;
        if (rateEma < 0.0105) halfRate = true;          // 100 Hz+ display: draw every other frame
        else if (rateEma > 0.0135) halfRate = false;
        if (rateEma > 0.0185) slowAt = now;
        if (!reduced) {
          if (rateEma > 0.027 && quality > 0.5 && now - lastAdjust > 2000) {
            quality = Math.max(0.5, quality - 0.12);      // frames are slow: thin the rain
            lastAdjust = now;
          } else if (quality < 1 && now - slowAt > 8000 && now - lastAdjust > 4000) {
            quality = Math.min(1, quality + 0.06);        // sustained smoothness: thicken again
            lastAdjust = now;
          }
        }
      }

      if (halfRate && now - lastDraw < 12.5) return;
      lastDraw = now;
      const dt = Math.min(0.1, acc);
      acc = 0;
      update(dt);
      draw();
    }

    function startLoop() {
      last = performance.now();
      lastDraw = 0;
      acc = 0;
      slowAt = lastAdjust = last;
      rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    resize();

    return {
      start() {
        wantRunning = true;
        if (reduced) { draw(); return; }
        if (!rafId) startLoop();
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
        if (was && !reduced) startLoop();
      },
      destroy() {
        wantRunning = false; stopLoop();
        while (live.length) retire(live.length - 1);
        cols = []; pool.length = 0; atlas = null;
      }
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

    const rafs = new Set();
    const undo = [];

    const FADE = function () { return motion.reduced() ? 0 : 1200; };

    /* ---- Lifecycle-safe helpers ----
       All Act timing runs on a pausable clock: while the tab is hidden the
       timeline freezes (the audio engine suspends at the same moment), so
       sound and visuals resume exactly where they left off. */

    const pending = new Set();
    let pausedAt = -1, pausedTotal = 0;

    const vnow = function () { return (pausedAt >= 0 ? pausedAt : performance.now()) - pausedTotal; };
    const arm = function (t) {
      t.started = performance.now();
      t.handle = setTimeout(function () { pending.delete(t); t.fn(); }, t.remaining);
    };
    const later = function (fn, ms) {
      const t = { fn: fn, remaining: Math.max(0, ms), started: 0, handle: 0 };
      pending.add(t);
      if (pausedAt < 0) arm(t);
    };
    const sleep = function (ms) {
      return new Promise(function (resolve) { later(resolve, ms); });
    };
    const tween = function (ms, fn) {
      return new Promise(function (resolve) {
        const t0 = vnow();
        let id = 0;
        const frame = function (now) {
          rafs.delete(id);
          const vt = Math.min(now, pausedAt >= 0 ? pausedAt : now) - pausedTotal;
          const p = Math.min(1, Math.max(0, (vt - t0) / ms));
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

    function pauseClock() {
      if (pausedAt >= 0) return;
      pausedAt = performance.now();
      pending.forEach(function (t) {
        clearTimeout(t.handle);
        t.remaining = Math.max(0, t.remaining - (pausedAt - t.started));
      });
    }
    function resumeClock() {
      if (pausedAt < 0) return;
      pausedTotal += performance.now() - pausedAt;
      pausedAt = -1;
      pending.forEach(arm);
    }
    on(document, 'visibilitychange', function () {
      if (document.hidden) pauseClock(); else resumeClock();
    });
    if (document.hidden) pauseClock();

    /* Audio-parameter updates from per-frame tweens are limited to ~22 Hz
       (the glides are smoothed on the audio thread anyway). */
    let lastAudioPush = 0;
    const audioDue = function (p) {
      const t = performance.now();
      if (p >= 1 || t - lastAudioPush >= 45) { lastAudioPush = t; return true; }
      return false;
    };

    /* The audio path has output latency; delaying the visual of a hard sync
       point by the same amount makes picture and sound land together. */
    const avLag = function () {
      try {
        const a = ctx.audio;
        return Math.min(120, Math.round(1000 * (a && a.latency ? a.latency() : 0)));
      } catch (e) { return 0; }
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

    // Typed answer
    const total = STREAM.length;
    const distinctN = new Set(STREAM).size;
    const repeatsN = total - distinctN;
    const ANSWER_WORDS = { 5: 'five' };      // accepted alongside the digit

    const form = el('form', 'a1-form');
    form.noValidate = true;
    const qLabel = el('label', 'a1-q', COPY.s3q);
    qLabel.htmlFor = 'a1-answer';
    const answerWrap = el('div', 'a1-answer');
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'a1-answer';
    input.className = 'a1-input';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('pattern', '[0-9]*');
    input.setAttribute('enterkeyhint', 'go');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('aria-describedby', 'a1-feedback');
    input.spellcheck = false;
    input.maxLength = 12;
    answerWrap.appendChild(input);
    const feedback = el('p', 'a1-feedback');
    feedback.id = 'a1-feedback';
    feedback.setAttribute('aria-live', 'polite');
    const submitBtn = el('button', 'a1-btn', 'SUBMIT');
    submitBtn.type = 'submit';
    submitBtn.disabled = true;
    form.append(qLabel, answerWrap, feedback, submitBtn);
    const formSlide = slide(form);

    const result = el('div');
    result.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%';
    const picked = el('p', 'a1-picked a1-fade');
    const counts = el('dl', 'a1-counts');
    const COUNT_DEFS = [
      { n: total, label: 'Arrivals' },
      { n: distinctN, label: 'Distinct elements' },
      { n: repeatsN, label: 'Repeated arrivals' }
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
    const hintSpan = el('span', null, COPY.gate);
    hint.appendChild(hintSpan);
    const gateLive = el('p', 'sr-only');
    gateLive.setAttribute('role', 'status');

    root.append(canvas, veil, secA, secB, secC, hint, gateLive);

    /* ---- Click / tap / key gate: a screen that waits for the visitor ---- */

    function gate() {
      return new Promise(function (resolve) {
        let armed = false, done = false;
        const offs = [];

        sleep(1200).then(function () {
          if (done) return;
          armed = true;
          const touch = isTouch();
          hintSpan.textContent = touch ? COPY.gateTouch : COPY.gate;
          hint.classList.add('is-on');
          gateLive.textContent = touch ? 'Tap to continue.' : 'Click or press Enter to continue.';
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
    const onResize = function () {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function () {
        rafs.delete(resizeRaf);
        resizeRaf = 0;
        rain.resize();
        if (arcsDrawn) drawArcs();
      });
      rafs.add(resizeRaf);
    };
    // The observer fires after layout has settled (rotation included); the
    // window listeners are the fallback for browsers without it.
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(onResize);
      ro.observe(canvas);
      undo.push(function () { ro.disconnect(); });
    } else {
      on(window, 'resize', onResize);
      on(window, 'orientationchange', function () { later(onResize, 250); });
    }
    undo.push(motion.subscribe(function (r) { rain.setReduced(r); }));

    /* ---- On-screen keyboard: keep the answer field and button visible ---- */

    function keepFormVisible() {
      if (document.activeElement !== input) return;
      try { form.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) { /* ignore */ }
    }
    on(input, 'focus', function () { later(keepFormVisible, 320); });
    if (window.visualViewport) {
      on(window.visualViewport, 'resize', function () { later(keepFormVisible, 60); });
    }

    /* ---- Counter ---- */

    let counterValue = 0, numShown = 0, numAt = 0;
    const numNode = numEl.firstChild;
    function setCounter(v, force) {
      const nv = Math.max(counterValue, Math.floor(v));
      counterValue = nv;
      const t = performance.now();
      if ((force || t - numAt >= 33) && nv !== numShown) {   // text updates capped at ~30 Hz
        numAt = t;
        numShown = nv;
        numNode.data = fmt.format(nv);
      }
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
        setCounter(90 * Math.pow(p * 8, 2.1), p >= 1);   // accelerating, ends near 7,092
        if (audioDue(p)) {
          snd.setTick(1.5 + 9 * p * p, tickPitch());
          snd.setDrone(0.7 + 0.3 * p, 0.2);
        }
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
        setCounter(v, p >= 1);
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
        if (audioDue(p)) {
          snd.setRain(0.6 + 0.4 * p, 0.2);
          snd.setSparkle(2.2 + 3 * p);
          snd.setTick(9 * Math.pow(5.5, p), tickPitch());
          snd.setRiser(p);
        }
      });

      // Abrupt freeze at exactly one billion: the picture stops when the
      // silence actually reaches the ear.
      snd.freeze();
      const lag = avLag();
      if (lag > 8) await sleep(lag);
      rain.stop();
      setCounter(1e9, true);
      counterWrap.classList.add('is-frozen');
      statusEl.classList.add('is-off');
      await sleep(2000);                // held silence

      snd.restore(0.1);                 // everything else is still at zero...
      snd.beat();                       // ...except one heartbeat in the stillness
      await sleep(1100);
      snd.setMood('calm', 5);
      snd.setDrone(0.75, 4);

      ctx.announce('The counter has frozen at 1,000,000,000 total arrivals. ' + COPY.s2.join(' '));
      open(s2aSlide);
      snd.chime(293.66, 0.9);
      await sleep(FADE() + 2200);
      open(s2bSlide);
      snd.chime(220.0, 0.9);
      await sleep(FADE() + 1400);

      await gate();                     // click / tap to continue

      open(memASlide);
      open(memA);
      snd.eight();
      await sleep(FADE() + 2200);

      ctx.announce('A container with eight empty slots appears, illustrating limited memory. ' + COPY.s2q);
      open(qSlide);
      snd.chime(220.0, 0.8);
      snd.chime(329.63, 0.6, 0.12);
      findBtn.focus({ preventScroll: true });
      bring(qSlide);

      await new Promise(function (resolve) {
        on(findBtn, 'click', function () { findBtn.disabled = true; resolve(); }, { once: true });
      });

      // Leave Scene 2: fade rain out
      snd.confirm();
      snd.whoosh(1.8);
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

    function isRight(raw) {
      const s = String(raw).trim().toLowerCase().replace(/[.\s]+$/, '');
      return s === String(distinctN) || s === ANSWER_WORDS[distinctN];
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

      ctx.announce(COPY.s3q + ' Type your answer, then submit.');
      open(formSlide);
      snd.chime(220.0, 0.7);
      // On touch devices the field is not auto-focused: an unprompted keyboard
      // would cover the stream. The visitor taps the field when ready.
      if (!isTouch()) later(function () { input.focus({ preventScroll: true }); }, 350);

      let attempts = 0;

      on(input, 'input', function () {
        submitBtn.disabled = !input.value.trim();
        if (input.classList.contains('is-wrong')) {
          input.classList.remove('is-wrong');
          input.removeAttribute('aria-invalid');
          feedback.classList.remove('is-wrong');
          feedback.textContent = '';
        }
        snd.tap();
      });

      await new Promise(function (resolve) {
        on(form, 'submit', function (e) {
          e.preventDefault();
          const v = input.value.trim();
          if (!v) return;

          if (isRight(v)) {
            input.readOnly = true;
            submitBtn.disabled = true;
            input.classList.add('is-right');
            feedback.classList.add('is-right');
            feedback.textContent = 'Yes.';
            input.blur();                 // dismiss the on-screen keyboard
            snd.success();
            resolve();
            return;
          }

          // Wrong answer: shake (or, under reduced motion, the border + message do the work)
          attempts++;
          snd.wrong();
          answerWrap.classList.remove('is-shake');
          void answerWrap.offsetWidth;
          answerWrap.classList.add('is-shake');
          later(function () { answerWrap.classList.remove('is-shake'); }, 600);
          input.classList.add('is-wrong');
          input.setAttribute('aria-invalid', 'true');
          feedback.classList.add('is-wrong');
          feedback.textContent = attempts >= 3
            ? 'Not quite. Hint: count each different letter only once.'
            : 'Not quite. Look at the stream again.';
          input.focus({ preventScroll: true });
          input.select();
        });
      });

      await sleep(1500);               // let the "Yes." land

      // Reveal
      close(formSlide);
      await sleep(FADE());

      encodeStream();
      await sleep(1200);

      const pickedText = 'There are ' + distinctN + ' distinct elements among ' + total + ' arrivals.';
      picked.textContent = pickedText;
      countEls[1].box.classList.add('is-answer');

      open(resultSlide);
      open(picked);
      await sleep(FADE() + 800);
      const COUNT_HZ = [293.66, 440.0, 587.33];
      for (let i = 0; i < countEls.length; i++) {
        open(countEls[i].box);
        snd.chime(COUNT_HZ[i], 0.9);
        await sleep(1200);
      }

      ctx.announce('Correct. ' + pickedText + ' There are ' + total + ' arrivals, ' + distinctN +
        ' distinct elements and ' + repeatsN + ' repeated arrivals. ' + COPY.s3expl.join(' '));
      await sleep(1000);
      for (let i = 0; i < explEls.length; i++) {
        open(explEls[i]);
        if (i === 2) { snd.chime(440, 0.9); snd.chime(659.25, 0.7, 0.1); }
        else snd.chime(i === 0 ? 220.0 : 246.94, 0.7);
        await sleep(FADE() + 2600);
      }

      await gate();                    // click / tap to continue
      await hideSec(secB);
      arcsDrawn = false;
    }

    /* ---- Scene 4: THE CONSTRAINT ---- */

    async function scene4() {
      ctx.announce('Scene 4: The constraint. ' + COPY.s4lines.join(' '));
      if (ctx.preloadNext) ctx.preloadNext();   // fetch the next Act while this one plays
      canvas.classList.remove('is-off');
      canvas.classList.add('is-subdued');
      veil.classList.add('is-on');
      rain.setDensity(0.4);
      rain.setSpeed(0.8);
      rain.start();

      snd.whoosh(2.4);
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

      await gate();                    // click / tap to continue

      ctx.announce(COPY.s4challenge + ' ' + COPY.s4support);
      open(chSlide);
      snd.setPulse(0.85);              // a slow heartbeat begins under the question
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

      await gate();                    // click / tap to continue

      // Closing: slow the rain, remove container and supporting material
      snd.setRain(0, 9);
      snd.setSparkle(0);
      snd.setMood('low', 10);
      snd.setDrone(0.3, 3);
      const slowing = tween(9000, function (p) {
        rain.setSpeed(0.8 * (1 - p) + 0.03 * p);
        rain.setDensity(0.4 * (1 - p) + 0.2 * p);
      });
      close(memC);
      close(memCSlide);
      s4Slides.forEach(close);
      close(formalSlide);
      await sleep(FADE() + 3500);       // the central question stands alone, heartbeat still going

      // The breath before the strike: heartbeat stops, drone drops away, a swell builds
      snd.setPulse(0);
      snd.setDrone(0, 1.4);
      close(supSlide);
      close(chSlide);
      open(closeSlide);                 // makes room; the line itself is still invisible
      const lead = FADE() + 1400;
      snd.riseIn(lead / 1000);
      await sleep(lead);

      // The strike: the line snaps in exactly on the hit
      snd.boom();                       // first hit lands 10 ms from now
      await sleep(10 + avLag());
      ctx.announce(COPY.closing);
      close1.classList.add('a1-hit');
      open(close1);
      await sleep(900);
      snd.setDrone(0.45, 1.5);
      await sleep(FADE() + 3600);
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
      pending.forEach(function (t) { clearTimeout(t.handle); });
      pending.clear();
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
