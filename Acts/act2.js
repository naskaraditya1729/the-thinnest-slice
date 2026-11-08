/* ============================================================================
   Act II — "Finding order in chaos"  (the number line, the points, the threshold)

   Self-contained module. Interface to script.js:
     enter(ctx) / exit()   — see the header of script.js.

   Structure
     - Eight scenes, each a factory (scene1 ... scene8) that builds its own SVG /
       DOM into the shared stage and returns { steps, step(k, prev), cap(k),
       layout(), gate(k), onNav() }.
     - A step is an authored checkpoint. Its visual state is a pure function of
       the step index and the scene's interaction state, so Back / Forward are
       deterministic.
     - Each mounted scene owns a "scope" (timers, tweens, listeners). The scope is
       disposed on every scene change and on exit: nothing leaks, and the Act can
       be entered, exited and re-entered.
     - A scope can fast-forward its running sequence. Forward on a busy screen
       completes the animation instead of skipping the step.

   Mathematical notes
     - Pictures that use a continuous interval [0,1) stand for the hash range
       0 ... M. The Act never states a numeric M.
     - Scene 6 uses the report's exact hash values and its exact retained states.
   ========================================================================== */

(function () {
  'use strict';

  const TTS = window.TheThinnestSlice;
  if (!TTS || typeof TTS.registerAct !== 'function') {
    console.error('[Act II] Controller not found; script.js must load first.');
    return;
  }

  const NS = 'http://www.w3.org/2000/svg';
  const TITLES = [
    'A DIFFERENT WAY TO LOOK',
    'ONE POINT PER DIFFERENT ELEMENT',
    'A RANGE FILLS WITH POINTS',
    'THE THRESHOLD',
    'THE QUESTION WE CANNOT ASK',
    'KEEP ONLY THE LEFTMOST',
    'THE BOUNDARY TELLS A STORY',
    'THE THINNEST SLICE'
  ];
  const STEPS = [4, 4, 3, 4, 3, 10, 5, 4];
  const SUB = '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089';

  const bufCache = new WeakMap();

  /* ---- Small utilities ---------------------------------------------------- */

  const clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  const ease = function (p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const svgEl = function (tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const hEl = function (tag, cls, html, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    if (parent) parent.appendChild(n);
    return n;
  };
  const mv = function (g, x, y, s) {
    g.style.transform = 'translate(' + x + 'px,' + y + 'px)' + (s == null ? '' : ' scale(' + s + ')');
  };
  const show = function (n, on) { n.classList.toggle('a2-off', !on); };

  /* ---- MathML helpers ------------------------------------------------------ */

  const mi = function (s, c) { return '<mi' + (c ? ' class="' + c + '"' : '') + '>' + s + '</mi>'; };
  const mn = function (s) { return '<mn>' + s + '</mn>'; };
  const mo = function (s) { return '<mo>' + s + '</mo>'; };
  const mt = function (s) { return '<mtext>' + s + '</mtext>'; };
  const row = function () { return '<mrow>' + Array.prototype.join.call(arguments, '') + '</mrow>'; };
  const sub = function (a, b) { return '<msub>' + a + b + '</msub>'; };
  const frac = function (a, b) { return '<mfrac>' + a + b + '</mfrac>'; };
  const mathI = function () { return '<math>' + Array.prototype.join.call(arguments, '') + '</math>'; };
  const mathB = function () { return '<math display="block">' + Array.prototype.join.call(arguments, '') + '</math>'; };

  const EX = '<mi mathvariant="normal">\uD835\uDD3C</mi>';       // double-struck E
  const Xx = sub(mi('X'), mi('x'));
  const expX = row(EX, mo('['), Xx, mo(']'));
  const APX = mo('\u2248');
  const IMP = mo('\u27F9');
  const dxM = function (unk) { return row(mi('d', unk ? 'a2-unk' : ''), frac(mi('x'), mi('M'))); };
  const tMd = function (unk) { return frac(row(mi('t'), mi('M')), mi('d', unk ? 'a2-unk' : '')); };
  const tMv = frac(row(mi('t'), mi('M')), mi('v'));
  const dTilde = '<mover accent="true">' + mi('d') + '<mo stretchy="false">~</mo></mover>';
  const hMap = function () {
    return mathI(mi('h'), mo(':'), mo('['), mi('m'), mo(']'), mo('\u2192'), mo('['), mi('M'), mo(']'));
  };
  const EQ_E1 = mathB(expX, APX, dxM(false));
  const eqMatch = function (unk) {
    return mathB(dxM(unk), APX, mi('t'), IMP, mi('x'), APX, tMd(unk));
  };

  /* ==========================================================================
     Sound (Web Audio, one-shots only; nothing is created while muted)
     ======================================================================== */

  function createSound(audio) {
    const names = ['step', 'tick', 'whoosh', 'ping', 'cross', 'land', 'good', 'nope', 'reveal', 'destroy'];
    const ac = audio && audio.context ? audio.context() : null;
    if (!ac || !audio.output) {
      const s = {};
      names.forEach(function (n) { s[n] = function () {}; });
      return s;
    }

    const bus = ac.createGain();
    bus.gain.value = 0.9;
    bus.connect(audio.output);

    let cache = bufCache.get(ac);
    if (!cache) { cache = {}; bufCache.set(ac, cache); }

    const noise = cache.noise2 || (cache.noise2 = (function () {
      const n = ac.sampleRate * 2;
      const b = ac.createBuffer(1, n, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })());
    const ir = cache.ir2 || (cache.ir2 = (function () {
      const n = Math.floor(ac.sampleRate * 1.8);
      const b = ac.createBuffer(1, n, ac.sampleRate);
      const d = b.getChannelData(0);
      const STEP = 128;
      for (let i = 0; i < n; i += STEP) {
        const e0 = Math.pow(1 - i / n, 2.8);
        const e1 = Math.pow(Math.max(0, 1 - (i + STEP) / n), 2.8);
        const end = Math.min(n, i + STEP);
        for (let j = i; j < end; j++) d[j] = (Math.random() * 2 - 1) * (e0 + (e1 - e0) * ((j - i) / STEP));
      }
      return b;
    })());

    const verb = ac.createConvolver();
    verb.buffer = ir;
    const vg = ac.createGain();
    vg.gain.value = 0.6;
    verb.connect(vg);
    vg.connect(bus);
    const send = ac.createGain();
    send.gain.value = 0.5;
    send.connect(verb);

    let voices = 0, dead = false;
    const ok = function () { return !dead && audio.running() && !(audio.muted && audio.muted()); };

    function tone(f, o) {
      if (!ok() || voices >= 12) return;
      o = o || {};
      const t = ac.currentTime + (o.delay || 0);
      const att = o.att == null ? 0.008 : o.att;
      const dur = o.dur || 0.5;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.gain || 0.04, t + att);
      g.gain.exponentialRampToValueAtTime(0.0001, t + att + dur);
      g.connect(bus);
      if (o.wet !== false) g.connect(send);
      const parts = o.bell ? [[1, 1], [2.76, 0.2]] : [[1, 1]];
      let left = parts.length;
      voices++;
      parts.forEach(function (p) {
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
          if (--left === 0) { g.disconnect(); voices--; }
        };
      });
    }

    const api = {
      step: function () { tone(520, { gain: 0.03, dur: 0.16, wet: false }); },
      tick: function () { tone(1250, { type: 'triangle', gain: 0.018, att: 0.002, dur: 0.05, wet: false }); },
      cross: function () { tone(1500 + Math.random() * 200, { type: 'triangle', gain: 0.012, att: 0.001, dur: 0.04, wet: false }); },
      land: function () { tone(170, { gain: 0.06, att: 0.004, dur: 0.22, wet: false }); tone(680, { gain: 0.02, dur: 0.3 }); },
      ping: function (f, vol, delay) { tone(f || 587.33, { bell: true, gain: 0.05 * (vol == null ? 1 : vol), att: 0.008, dur: 1.6, delay: delay || 0 }); },
      good: function () { api.ping(587.33, 0.9, 0); api.ping(880, 0.8, 0.1); },
      nope: function () { tone(140, { type: 'triangle', gain: 0.05, att: 0.004, dur: 0.22, wet: false }); },
      reveal: function () { [293.66, 440, 587.33, 880].forEach(function (f, i) { api.ping(f, 0.8, i * 0.11); }); },
      whoosh: function () {
        if (!ok()) return;
        const t = ac.currentTime, secs = 1.3;
        const n = ac.createBufferSource();
        n.buffer = noise;
        n.loop = true;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 0.9;
        bp.frequency.setValueAtTime(300, t);
        bp.frequency.exponentialRampToValueAtTime(3000, t + secs);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.03, t + secs * 0.45);
        g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
        n.connect(bp); bp.connect(g); g.connect(bus); g.connect(send);
        n.start(t);
        n.stop(t + secs + 0.05);
        n.onended = function () { n.disconnect(); bp.disconnect(); g.disconnect(); };
      },
      destroy: function () {
        if (dead) return;
        dead = true;
        try { bus.disconnect(); verb.disconnect(); vg.disconnect(); send.disconnect(); } catch (e) { /* ignore */ }
      }
    };
    return api;
  }

  /* ==========================================================================
     Scope: timers, tweens and listeners owned by one mounted scene (or the Act)
     ======================================================================== */

  function makeScope(motion) {
    const timers = new Map();
    const actives = new Set();
    const rafs = new Set();
    const offs = [];
    let dead = false, skipping = false, seqCount = 0;

    const sc = {
      later: function (fn, ms, seq) {
        if (dead) return null;
        const rec = { fn: fn, at: performance.now() + ms, seq: !!seq, id: 0 };
        rec.id = setTimeout(function () {
          timers.delete(rec);
          if (rec.seq) seqCount--;
          if (!dead) fn();
        }, ms);
        timers.set(rec, rec);
        if (rec.seq) seqCount++;
        return rec;
      },
      cancel: function (rec) {
        if (!rec || !timers.has(rec)) return;
        clearTimeout(rec.id);
        timers.delete(rec);
        if (rec.seq) seqCount--;
      },
      tween: function (ms, fn, done) {
        if (dead) return;
        if (skipping || (motion && motion.reduced())) { fn(1); if (done) done(); return; }
        const a = {};
        actives.add(a);
        const t0 = performance.now();
        let id = 0;
        const fin = function () {
          actives.delete(a);
          if (id) { cancelAnimationFrame(id); rafs.delete(id); id = 0; }
        };
        a.cancel = fin;
        a.complete = function () { fin(); fn(1); if (done) done(); };
        const frame = function (now) {
          rafs.delete(id);
          id = 0;
          if (dead) return;
          const p = clamp((now - t0) / ms, 0, 1);
          fn(ease(p));
          if (p < 1) { id = requestAnimationFrame(frame); rafs.add(id); }
          else { fin(); if (done) done(); }
        };
        id = requestAnimationFrame(frame);
        rafs.add(id);
      },
      on: function (t, type, fn, o) {
        t.addEventListener(type, fn, o);
        offs.push(function () { t.removeEventListener(type, fn, o); });
      },
      busy: function () { return actives.size > 0 || seqCount > 0; },
      /* Stop the running sequence where it is (no completion). */
      reset: function () {
        timers.forEach(function (r) {
          if (r.seq) { clearTimeout(r.id); timers.delete(r); }
        });
        seqCount = 0;
        Array.from(actives).forEach(function (a) { a.cancel(); });
      },
      /* Run the whole remaining sequence to its end state, immediately. */
      fastForward: function () {
        skipping = true;
        let guard = 0;
        while (guard++ < 600) {
          if (actives.size) { Array.from(actives).forEach(function (a) { a.complete(); }); continue; }
          let next = null;
          timers.forEach(function (r) { if (!next || r.at < next.at) next = r; });
          if (!next) break;
          clearTimeout(next.id);
          timers.delete(next);
          if (next.seq) seqCount--;
          next.fn();
        }
        skipping = false;
      },
      dispose: function () {
        dead = true;
        timers.forEach(function (r) { clearTimeout(r.id); });
        timers.clear();
        seqCount = 0;
        Array.from(actives).forEach(function (a) { a.cancel(); });
        actives.clear();
        rafs.forEach(function (id) { cancelAnimationFrame(id); });
        rafs.clear();
        offs.splice(0).forEach(function (f) { f(); });
      }
    };
    return sc;
  }

  /* ==========================================================================
     Shared SVG parts
     ======================================================================== */

  function makeAxis(parent, labels, nt) {
    const line = svgEl('line', { class: 'a2-axis' }, parent);
    const tk = [];
    for (let i = 0; i <= nt; i++) tk.push(svgEl('line', { class: 'a2-tick' }, parent));
    const lb = labels.map(function (l) {
      const t = svgEl('text', { class: 'a2-axl', 'text-anchor': 'middle' }, parent);
      t.textContent = l[1];
      return { u: l[0], t: t };
    });
    return {
      layout: function (L, R, y) {
        line.setAttribute('x1', L); line.setAttribute('x2', R);
        line.setAttribute('y1', y); line.setAttribute('y2', y);
        tk.forEach(function (t, i) {
          const x = L + (R - L) * i / nt;
          const big = i === 0 || i === nt;
          t.setAttribute('x1', x); t.setAttribute('x2', x);
          t.setAttribute('y1', y - (big ? 7 : 4)); t.setAttribute('y2', y + (big ? 7 : 4));
        });
        lb.forEach(function (l) {
          l.t.setAttribute('x', L + (R - L) * l.u);
          l.t.setAttribute('y', y + 25);
        });
      }
    };
  }

  function makePoint(parent) {
    const g = svgEl('g', { class: 'a2-pt a2-t' }, parent);
    svgEl('circle', { class: 'a2-halo', r: 9 }, g);
    svgEl('circle', { class: 'a2-ring', r: 6 }, g);
    svgEl('circle', { class: 'a2-dot', r: 5 }, g);
    return g;
  }

  function chip(parent, label) {
    const g = svgEl('g', { class: 'a2-chip' }, parent);
    svgEl('rect', { x: -16, y: -16, width: 32, height: 32, rx: 3 }, g);
    const t = svgEl('text', { 'text-anchor': 'middle', y: 6 }, g);
    t.textContent = label;
    return g;
  }

  /* A uniform field of points on the hash axis, with optional threshold, chart
     (realised staircase vs expected line), boundary marker "v". Positions are
     fractions u in [0,1) of the range. */
  function makeField(X, o) {
    const geo = X.geo;
    const F = { n: o.n, chart: !!o.chart, f: o.f0 == null ? 0.3 : o.f0, G: null, pts: [], t: o.t || 5, v: null, cnt: 0 };
    F.g = svgEl('g', { class: 'a2-t' }, X.svg);
    F.shade = svgEl('rect', { class: 'a2-shade a2-t a2-off' }, F.g);
    F.axis = makeAxis(F.g, [[0, '0'], [1, 'M']], 8);

    if (F.chart) {
      F.gc = svgEl('g', { class: 'a2-t a2-off' }, F.g);
      F.cBase = svgEl('line', { class: 'a2-tick' }, F.gc);
      F.cLbl0 = svgEl('text', { 'text-anchor': 'end' }, F.gc); F.cLbl0.textContent = '0';
      F.cLblD = svgEl('text', { 'text-anchor': 'end' }, F.gc); F.cLblD.textContent = 'd';
      F.stepPath = svgEl('path', { class: 'a2-step a2-t a2-off' }, F.gc);
      F.linePath = svgEl('line', { class: 'a2-lin a2-t a2-off' }, F.gc);
      F.levelT = svgEl('line', { class: 'a2-lvl a2-t a2-off' }, F.gc);
      F.levelTt = svgEl('text', { class: 'a2-lbl-big a2-t a2-off', 'text-anchor': 'end' }, F.gc); F.levelTt.textContent = 't';
      F.mReal = svgEl('circle', { class: 'a2-mreal a2-t a2-off', r: 5 }, F.gc);
      F.mExp = svgEl('circle', { class: 'a2-mexp a2-t a2-off', r: 5 }, F.gc);
      F.lReal = svgEl('text', { class: 'a2-legR a2-t a2-off' }, F.gc); F.lReal.textContent = 'realised count (steps)';
      F.lExp = svgEl('text', { class: 'a2-legE a2-t a2-off' }, F.gc); F.lExp.textContent = 'expected count (line)';
    }

    F.gPts = svgEl('g', {}, F.g);
    for (let i = 0; i < F.n; i++) {
      const g = makePoint(F.gPts);
      g.classList.add('a2-off');
      F.pts.push({ g: g, v: 0, j: 0, x: 0, y: 0 });
    }
    F.regen = function (seed) {
      const r = mulberry32(seed * 7919 + 13);
      F.pts.forEach(function (p) { p.v = r(); p.j = r(); });
    };
    F.regen(o.seed || 0);

    F.thr = svgEl('g', { class: 'a2-thr a2-t a2-off' + (o.live ? ' a2-live' : '') }, F.g);
    F.thrLine = svgEl('line', { class: 'a2-thrl', x1: 0, x2: 0 }, F.thr);
    F.thrHandle = svgEl('circle', { class: 'a2-thrh', r: 7, cx: 0 }, F.thr);
    F.thrLbl = svgEl('text', { class: 'a2-lbl-big', 'text-anchor': 'middle' }, F.thr);
    F.thrLbl.textContent = 'x';

    F.vm = svgEl('g', { class: 'a2-vm a2-t a2-off' }, F.g);
    F.vmLine = svgEl('line', { class: 'a2-vml', x1: 0, x2: 0 }, F.vm);
    F.vmTxt = svgEl('text', { class: 'a2-lbl-big', 'text-anchor': 'middle' }, F.vm);
    F.vmTxt.textContent = 'v';

    F.count = function (f) {
      let c = 0;
      for (let i = 0; i < F.n; i++) if (F.pts[i].v < f) c++;
      return c;
    };

    F.setThr = function (f) {
      F.f = f;
      if (!F.G) return;
      const x = F.xOf(f);
      const top = F.axisY - F.band - 6;
      mv(F.thr, x, 0);
      F.thrLine.setAttribute('y1', top);
      F.thrLine.setAttribute('y2', F.chart ? F.yc1 : F.axisY + 8);
      F.thrHandle.setAttribute('cy', F.axisY);
      F.thrLbl.setAttribute('y', top - 6);
      F.shade.setAttribute('x', F.G.L);
      F.shade.setAttribute('y', top);
      F.shade.setAttribute('width', Math.max(0, x - F.G.L));
      F.shade.setAttribute('height', F.axisY - top);
      let c = 0;
      F.pts.forEach(function (p) {
        const inn = p.v < f;
        p.g.classList.toggle('is-in', inn);
        if (inn) c++;
      });
      F.cnt = c;
      if (F.chart) {
        F.mReal.setAttribute('cx', x); F.mReal.setAttribute('cy', F.cy(c));
        F.mExp.setAttribute('cx', x); F.mExp.setAttribute('cy', F.cy(F.n * f));
      }
      if (F.onThr) F.onThr(f, c);
    };

    F.clearIn = function () { F.pts.forEach(function (p) { p.g.classList.remove('is-in'); }); };

    F.setKeep = function (t, d) {
      const idx = [];
      for (let i = 0; i < d; i++) idx.push(i);
      idx.sort(function (a, b) { return F.pts[a].v - F.pts[b].v; });
      const keep = new Set(idx.slice(0, t));
      F.pts.forEach(function (p, i) { p.g.classList.toggle('is-keep', t > 0 && keep.has(i)); });
      F.v = t > 0 && t <= d ? F.pts[idx[t - 1]].v : null;
    };

    F.setV = function () {
      if (!F.G || F.v == null) return;
      const top = F.axisY - F.band - 6;
      mv(F.vm, F.xOf(F.v), 0);
      F.vmLine.setAttribute('y1', top);
      F.vmLine.setAttribute('y2', F.axisY + 10);
      F.vmTxt.setAttribute('y', top - 6);
    };

    F.showN = function (d) { F.pts.forEach(function (p, i) { show(p.g, i < d); }); };

    F.renderChart = function () {
      if (!F.chart || !F.G) return;
      const G = F.G;
      let d = 'M' + G.L + ',' + F.yc1;
      const sorted = F.pts.map(function (p) { return p.v; }).sort(function (a, b) { return a - b; });
      sorted.forEach(function (v, i) { d += ' H' + F.xOf(v) + ' V' + F.cy(i + 1); });
      d += ' H' + G.R;
      F.stepPath.setAttribute('d', d);
      F.linePath.setAttribute('x1', G.L); F.linePath.setAttribute('y1', F.yc1);
      F.linePath.setAttribute('x2', G.R); F.linePath.setAttribute('y2', F.yc0);
      F.cBase.setAttribute('x1', G.L); F.cBase.setAttribute('x2', G.R);
      F.cBase.setAttribute('y1', F.yc1); F.cBase.setAttribute('y2', F.yc1);
      F.cLbl0.setAttribute('x', G.L - 6); F.cLbl0.setAttribute('y', F.yc1 + 4);
      F.cLblD.setAttribute('x', G.L - 6); F.cLblD.setAttribute('y', F.yc0 + 4);
      const ty = F.cy(F.t);
      F.levelT.setAttribute('x1', G.L); F.levelT.setAttribute('x2', G.R);
      F.levelT.setAttribute('y1', ty); F.levelT.setAttribute('y2', ty);
      F.levelTt.setAttribute('x', G.L - 6); F.levelTt.setAttribute('y', ty + 5);
      F.lReal.setAttribute('x', G.L + 8); F.lReal.setAttribute('y', F.yc0 - 6);
      F.lExp.setAttribute('x', G.L + 8); F.lExp.setAttribute('y', F.yc0 + 9);
    };

    F.layout = function () {
      const G = geo();
      F.G = G;
      const h = G.h, mob = G.mob;
      F.axisY = h * (F.chart ? (mob ? 0.34 : 0.38) : 0.68);
      F.band = Math.max(40, Math.min(F.axisY - 24, mob ? 120 : 190));
      F.xOf = function (u) { return G.L + u * (G.R - G.L); };
      F.axis.layout(G.L, G.R, F.axisY);
      F.pts.forEach(function (p) {
        p.x = F.xOf(p.v);
        p.y = F.axisY - 14 - p.j * (F.band - 14);
        mv(p.g, p.x, p.y);
      });
      if (F.chart) {
        F.yc1 = h - (mob ? 30 : 36);
        F.yc0 = Math.min(F.yc1 - 50, F.axisY + (mob ? 46 : 54));
        F.cy = function (c) { return F.yc1 - (c / F.n) * (F.yc1 - F.yc0); };
        F.renderChart();
      }
      F.setThr(F.f);
      F.setV();
    };

    return F;
  }

  /* ==========================================================================
     SCENE 1 — A DIFFERENT WAY TO LOOK
     ======================================================================== */

  function scene1(X) {
    const svg = X.svg, sc = X.sc, snd = X.snd, geo = X.geo;
    const HV = { a: 37, b: 9, c: 52 };                // illustrative hash values
    const STREAM = ['a', 'b', 'a', 'c', 'd', 'b', 'e', 'c'];
    const root = svgEl('g', {}, svg);
    const gChips = svgEl('g', { class: 'a2-t' }, root);
    const chips = STREAM.map(function (l) { return chip(gChips, l); });
    const gMain = svgEl('g', { class: 'a2-t a2-off' }, root);
    const axis = makeAxis(gMain, [[0, '0'], [1, 'M']], 8);
    const boxG = svgEl('g', { class: 'a2-box' }, gMain);
    svgEl('rect', { x: -44, y: -32, width: 88, height: 64, rx: 4 }, boxG);
    const boxT = svgEl('text', { class: 'a2-boxt', 'text-anchor': 'middle', y: 14 }, boxG);
    boxT.textContent = 'h';

    const marks = {};
    Object.keys(HV).forEach(function (l) {
      const g = makePoint(gMain);
      g.classList.add('a2-off');
      const t = svgEl('text', { 'text-anchor': 'middle', y: -20 }, g);
      t.textContent = 'h(' + l + ') = ' + HV[l];
      const s = svgEl('text', { 'text-anchor': 'middle', y: 30 }, g);
      marks[l] = { g: g, t: t, s: s, n: 0, u: HV[l] / 64 };
    });

    const tokL = svgEl('g', { class: 'a2-tok a2-off' }, root);
    svgEl('circle', { r: 15 }, tokL);
    const tokLt = svgEl('text', { 'text-anchor': 'middle', y: 6 }, tokL);
    const tokD = svgEl('g', { class: 'a2-tokd a2-off' }, root);
    svgEl('circle', { r: 6 }, tokD);

    const P = {};

    function layout() {
      const G = geo();
      P.G = G;
      P.axisY = G.h * 0.74;
      P.boxX = G.w / 2;
      P.boxY = G.h * 0.34;
      P.srcX = G.L + (G.mob ? 24 : 56);
      axis.layout(G.L, G.R, P.axisY);
      mv(boxG, P.boxX, P.boxY);
      chips.forEach(function (c, i) { mv(c, G.L + (G.R - G.L) * (i + 0.5) / 8, G.h * 0.3); });
      Object.keys(marks).forEach(function (l) { mv(marks[l].g, G.L + (G.R - G.L) * marks[l].u, P.axisY); });
    }

    function setMark(l, n) {
      const m = marks[l];
      m.n = n;
      show(m.g, n > 0);
      m.s.textContent = n > 1 ? 'sent \u00D7' + n : '';
    }
    function clearMarks() { Object.keys(marks).forEach(function (l) { setMark(l, 0); }); }
    function clearAnim() {
      sc.reset();
      tokL.classList.add('a2-off'); tokL.style.opacity = '';
      tokD.classList.add('a2-off');
    }

    function land(l) {
      setMark(l, marks[l].n + 1);
      if (marks[l].n > 1) X.ping(marks[l].g);
      snd.land();
    }

    function send(l) {
      const G = P.G, m = marks[l];
      tokLt.textContent = l;
      tokL.classList.remove('a2-off');
      mv(tokL, P.srcX, P.boxY);
      snd.tick();
      const tx = G.L + (G.R - G.L) * m.u, ty = P.axisY;
      const sx = P.boxX, sy = P.boxY + 34;
      sc.tween(900, function (p) {
        mv(tokL, P.srcX + (P.boxX - P.srcX) * p, P.boxY, 1 - 0.5 * p);
        tokL.style.opacity = String(1 - 0.9 * p);
      }, function () {
        tokL.classList.add('a2-off');
        tokL.style.opacity = '';
        tokD.classList.remove('a2-off');
        mv(tokD, sx, sy);
        snd.tick();
        sc.tween(1000, function (p) {
          const q = 1 - p;
          const x = q * q * sx + 2 * q * p * sx + p * p * tx;      // control point (sx, ty)
          const y = q * q * sy + 2 * q * p * ty + p * p * ty;
          mv(tokD, x, y);
        }, function () {
          tokD.classList.add('a2-off');
          land(l);
        });
      });
    }

    const btns = ['a', 'b', 'c'].map(function (l) {
      const b = X.btn('SEND ' + l, function () { if (!sc.busy()) send(l); }, 'Send element ' + l + ' through h');
      b.hidden = true;
      return b;
    });

    return {
      steps: STEPS[0],
      layout: layout,
      step: function (k, prev) {
        show(gChips, k === 0);
        show(gMain, k >= 1);
        if (k < 2) { clearAnim(); clearMarks(); }
        else if (k === 2) {
          clearAnim();
          clearMarks();
          if (prev === 1) sc.later(function () { send('a'); }, 900, true);
          else setMark('a', 1);
        } else if (marks.a.n < 1) setMark('a', 1);
        btns.forEach(function (b) { b.hidden = k !== 3; });
      },
      cap: function (k) {
        if (k === 0) return { html: '<p>We need to estimate how many <b>different</b> elements have appeared.</p><p class="a2-dim">But remembering every element is too expensive.</p>' };
        if (k === 1) return { html: '<p>What if every possible element had a numerical address?</p>' };
        if (k === 2) return { html: '<p>Pass an element through a black box <i>h</i>, and it emerges as a point on a number line.</p>' };
        return {
          html: '<p>' + hMap() + '</p><p>Every possible element in ' + mathI(mo('['), mi('m'), mo(']')) +
            ' is sent to a number in the range ' + mathI(mo('['), mi('M'), mo(']')) +
            '. Send the same element again: it lands on exactly the same point.</p>',
          say: 'The hash function h maps each possible element to a number in the range. Send an element again and it lands on exactly the same point.'
        };
      }
    };
  }

  /* ==========================================================================
     SCENE 2 — ONE POINT PER DIFFERENT ELEMENT
     ======================================================================== */

  function scene2(X) {
    const svg = X.svg, sc = X.sc, snd = X.snd, geo = X.geo, ov = X.ov;
    const STREAM = ['a', 'b', 'a', 'c', 'd', 'b', 'e', 'c'];
    const LET = ['a', 'b', 'c', 'd', 'e'];
    const HV = { a: 37, b: 9, c: 52, d: 22, e: 58 };      // illustrative, collision-free
    const first = {};
    STREAM.forEach(function (l, i) { if (first[l] == null) first[l] = i; });

    const root = svgEl('g', {}, svg);
    const gTr = svgEl('g', {}, root);
    const traces = STREAM.map(function () { return svgEl('path', { class: 'a2-trace' }, gTr); });
    const axis = makeAxis(root, [[0, '0'], [1, 'M']], 8);
    const pts = {};
    LET.forEach(function (l) {
      const g = makePoint(root);
      g.classList.add('a2-off');
      const t = svgEl('text', { class: 'a2-lbl-big', 'text-anchor': 'middle', y: 30 }, g);
      t.textContent = l;
      pts[l] = { g: g, t: t };
    });
    const tiles = STREAM.map(function (l) {
      const g = chip(root, l);
      const tag = svgEl('text', { class: 'a2-tag', 'text-anchor': 'middle', y: 31 }, g);
      return { g: g, tag: tag };
    });
    const pulse = svgEl('g', { class: 'a2-tokd a2-off' }, root);
    svgEl('circle', { r: 6 }, pulse);

    const read = hEl('div', 'a2-read bot', '', ov);
    const pA = hEl('span', 'a2-pill a2-t a2-off', '', read);
    const pD = hEl('span', 'a2-pill a2-t a2-off', '', read);

    let lens = [];
    const drawn = STREAM.map(function () { return false; });

    function layout() {
      const G = geo();
      const ay = G.h * 0.68, ty = G.h * 0.16;
      axis.layout(G.L, G.R, ay);
      LET.forEach(function (l) { mv(pts[l].g, G.L + (G.R - G.L) * HV[l] / 64, ay); });
      STREAM.forEach(function (l, i) {
        const tx = G.L + (G.R - G.L) * (i + 0.5) / 8;
        mv(tiles[i].g, tx, ty);
        const px = G.L + (G.R - G.L) * HV[l] / 64;
        const y0 = ty + 17, mid = (y0 + ay) / 2;
        traces[i].setAttribute('d', 'M' + tx + ',' + y0 + ' C' + tx + ',' + mid + ' ' + px + ',' + mid + ' ' + px + ',' + ay);
      });
      lens = traces.map(function (p) { return p.getTotalLength(); });
      traces.forEach(function (p, i) {
        p.style.strokeDasharray = String(lens[i]);
        p.style.strokeDashoffset = drawn[i] ? '0' : String(lens[i]);
      });
    }

    function counts(n, dn) {
      pA.innerHTML = '<span>arrivals</span> <b>' + n + '</b>';
      pD.innerHTML = '<span>distinct points</span> <b>' + dn + '</b>';
    }

    function applyProgress(n) {
      let dn = 0;
      STREAM.forEach(function (l, i) {
        const d = i < n;
        drawn[i] = d;
        traces[i].style.strokeDashoffset = d ? '0' : String(lens[i] || 0);
        tiles[i].g.classList.toggle('is-done', d);
        tiles[i].g.classList.remove('is-cur');
        tiles[i].tag.textContent = d ? (first[l] === i ? 'new' : 'again') : '';
        if (d && first[l] === i) dn++;
      });
      LET.forEach(function (l) { show(pts[l].g, first[l] < n); });
      counts(n, dn);
    }

    function setLabels(mode) {
      LET.forEach(function (l, i) { pts[l].t.textContent = mode === 'b' ? 'b' + SUB.charAt(i + 1) : l; });
    }

    function landed(i) {
      const l = STREAM[i];
      let dn = 0;
      for (let j = 0; j <= i; j++) if (first[STREAM[j]] === j) dn++;
      tiles[i].tag.textContent = first[l] === i ? 'new' : 'again';
      tiles[i].g.classList.add('is-done');
      if (first[l] === i) { show(pts[l].g, true); snd.land(); }
      else { X.ping(pts[l].g); snd.tick(); }
      counts(i + 1, dn);
    }

    function arrive(i) {
      tiles[i].g.classList.add('is-cur');
      pulse.classList.remove('a2-off');
      snd.tick();
      const len = lens[i] || 0;
      sc.tween(900, function (p) {
        traces[i].style.strokeD
