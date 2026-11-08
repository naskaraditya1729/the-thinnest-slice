/* ============================================================================
   Act II — FINDING ORDER IN CHAOS
   Self-contained module. Interface to script.js: enter(ctx) / exit().

   Structure
     SCENES[]   eight scenes; each has a title, a beat count `n`, and build(S)
                which draws the static picture and returns one function per
                beat. A beat only moves the picture forward (cumulatively), so
                the engine can re-create any checkpoint by replaying beats
                0..k instantly. That is how Back, resizing and re-entry stay
                deterministic.
     Forward    next beat, then next scene; after the last beat -> ctx.complete()
     Back       previous beat / scene; from the very first beat -> ctx.previous()
     Gates      a beat may call S.gate(key): Forward stays disabled until
                S.unlock(key) (scene 6 stepping, scene 8 question).

   Everything created (timers, listeners, observers, audio voices, DOM) is
   released in destroy(). Sound is off until the visitor turns it on.

   Mathematics: the hash positions drawn here are an idealised, collision-free
   illustration. Nothing is presented as a proof.
   ========================================================================== */

(function () {
  'use strict';

  const TTS = window.TheThinnestSlice;
  if (!TTS || typeof TTS.registerAct !== 'function') {
    console.error('[Act II] Controller not found; script.js must load first.');
    return;
  }

  const NS = 'http://www.w3.org/2000/svg';

  /* ---- Data -------------------------------------------------------------- */

  const STREAM = ['a', 'b', 'a', 'c', 'd', 'b', 'e', 'c'];
  const NAMES = ['a', 'b', 'c', 'd', 'e'];
  const HASHU = { a: 0.62, b: 0.18, c: 0.81, d: 0.40, e: 0.27 };   // illustrative, collision-free
  const SUBS = ['\u2081', '\u2082', '\u2083', '\u2084', '\u2085'];

  const HV = [12, 47, 5, 31, 19, 63, 8, 52];                        // the report's example, in arrival order
  const T6 = 3;

  function runUpdate(vals, t) {
    const out = [];
    let set = [];
    vals.forEach(function (r) {
      let act;
      if (set.indexOf(r) >= 0) {
        act = 'dup';
      } else if (set.length < t) {
        set.push(r); act = 'insert';
      } else {
        const mx = Math.max.apply(null, set);
        if (r < mx) { set.splice(set.indexOf(mx), 1); set.push(r); act = 'replace:' + mx; }
        else act = 'discard:' + mx;
      }
      set.sort(function (a, b) { return a - b; });
      out.push({ r: r, set: set.slice(), act: act });
    });
    return out;
  }
  const STATES = runUpdate(HV, T6);
  if (JSON.stringify(STATES.map(function (s) { return s.set; })) !==
      '[[12],[12,47],[5,12,47],[5,12,31],[5,12,19],[5,12,19],[5,8,12],[5,8,12]]') {
    console.warn('[Act II] The scene 6 update rule no longer reproduces the specified retained sets.');
  }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seq(seed, n) { const r = rng(seed), a = []; for (let i = 0; i < n; i++) a.push(r()); return a; }
  function jit(i, seed) { const s = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453; return s - Math.floor(s); }

  /* ---- MathML helpers ---------------------------------------------------- */

  const mi = function (x) { return '<mi>' + x + '</mi>'; };
  const mn = function (x) { return '<mn>' + x + '</mn>'; };
  const mo = function (x) { return '<mo>' + x + '</mo>'; };
  const row = function () { return '<mrow>' + Array.prototype.join.call(arguments, '') + '</mrow>'; };
  const sub = function (a, b) { return '<msub>' + a + b + '</msub>'; };
  const frac = function (a, b) { return '<mfrac>' + a + b + '</mfrac>'; };
  const mth = function (c, block) { return '<math' + (block ? ' display="block"' : '') + '>' + c + '</math>'; };
  const APX = mo('\u2248'), IMP = mo('\u27F9');
  const E_X = row(mi('\uD835\uDD3C'), mo('['), sub(mi('X'), mi('x')), mo(']'));
  const DX_M = row(mi('d'), frac(mi('x'), mi('M')));
  const TM_D = frac(row(mi('t'), mi('M')), mi('d'));
  const TM_V = frac(row(mi('t'), mi('M')), mi('v'));
  const F_EXP = row(E_X, APX, DX_M);
  const DTILDE = '<mover accent="true"><mi>d</mi><mo stretchy="false">\u02DC</mo></mover>';
  const I = function (s) { return '<i>' + s + '</i>'; };
  const P = function (s, dim) { return '<p' + (dim ? ' class="a2-dim"' : '') + '>' + s + '</p>'; };
  const SERIF = 'font-family:"STIX Two Text",Georgia,serif;font-style:italic;';

  /* ---- DOM / SVG helpers ------------------------------------------------- */

  const el = function (tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svgEl = function (tag, attrs, parent, cls) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (cls) n.setAttribute('class', cls);
    if (parent) parent.appendChild(n);
    return n;
  };
  const tr = function (n, x, y) { n.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  const off = function (n, v) { n.classList.toggle('a2-off', !!v); };
  const cls = function (n, c, v) { n.classList.toggle(c, !!v); };
  const ping = function (n) { n.classList.remove('is-ping'); void n.getBoundingClientRect(); n.classList.add('is-ping'); };

  function axis(S, y, mid, right) {
    const g = S.el('g', null, null, 'a2-t');
    S.el('line', { x1: S.x0, y1: y, x2: S.x1, y2: y }, g, 'a2-axis');
    for (let i = 0; i <= 10; i++) {
      const x = S.x0 + (S.x1 - S.x0) * i / 10;
      S.el('line', { x1: x, y1: y - 4, x2: x, y2: y + 4 }, g, 'a2-tick');
    }
    const a = S.el('text', { x: S.x0, y: y + 22, 'text-anchor': 'middle' }, g, 'a2-axl');
    a.textContent = '0';
    const b = S.el('text', { x: S.x1, y: y + 22, 'text-anchor': 'middle' }, g, 'a2-axl');
    if (right != null) b.textContent = right;
    else { b.textContent = 'M'; b.setAttribute('style', SERIF + 'font-size:16px'); }
    if (mid) {
      const c = S.el('text', { x: (S.x0 + S.x1) / 2, y: y + 22, 'text-anchor': 'middle' }, g, 'a2-axl');
      c.textContent = mid;
    }
    return g;
  }

  function mkPoint(S, parent, x, y, label, ly, r) {
    const g = S.el('g', null, parent, 'a2-pt a2-t');
    tr(g, x, y);
    if (r) {
      const d = S.el('circle', { r: r }, g, 'a2-dot');
      d.style.r = r + 'px';
    } else {
      S.el('circle', { r: 9 }, g, 'a2-halo');
      S.el('circle', { r: 6 }, g, 'a2-ring');
      S.el('circle', { r: 5 }, g, 'a2-dot');
    }
    if (label != null) {
      const t = S.el('text', { y: ly == null ? -14 : ly, 'text-anchor': 'middle' }, g);
      t.textContent = label;
    }
    return g;
  }

  function tok(S, parent, label, x, y, hidden) {
    const g = S.el('g', null, parent, 'a2-tok a2-t' + (hidden ? ' a2-off' : ''));
    tr(g, x, y);
    S.el('circle', { r: 15 }, g);
    const t = S.el('text', { y: 5, 'text-anchor': 'middle' }, g);
    t.textContent = label;
    return g;
  }

  /* ========================================================================
     SCENES
     ====================================================================== */

  /* ---- 1. A DIFFERENT WAY TO LOOK ---------------------------------------- */

  function sc1(S) {
    const W = S.W, H = S.H, ay = Math.round(H * 0.74), by = Math.round(H * 0.34);
    const bx = Math.round(W / 2), bw = 78, bh = 58, px = S.X(HASHU.a), yb = by + bh / 2;
    const ax = axis(S, ay, 'hash range'); off(ax, 1);
    const rowG = S.el('g', null, null, 'a2-t');
    ['a', 'b', 'a', 'c', 'd'].forEach(function (l, i) { tok(S, rowG, l, bx + (i - 2) * 52, 28); });
    const hero = tok(S, S.g, 'a', bx, 24, true);
    const box = S.el('g', null, null, 'a2-box a2-t'); tr(box, bx - bw / 2, by - bh / 2); off(box, 1);
    S.el('rect', { width: bw, height: bh }, box);
    const bt = S.el('text', { x: bw / 2, y: bh / 2 + 13, 'text-anchor': 'middle' }, box, 'a2-boxt'); bt.textContent = 'h';
    const ym = (yb + ay) / 2;
    const trace = S.el('path', { d: 'M ' + bx + ' ' + yb + ' C ' + bx + ' ' + ym + ' ' + px + ' ' + ym + ' ' + px + ' ' + (ay - 12) }, null, 'a2-trace a2-t');
    off(trace, 1);
    const pa = mkPoint(S, S.g, px, ay, 'a'); off(pa, 1);
    const hl = S.el('text', { x: px, y: ay + 42, 'text-anchor': 'middle', style: SERIF + 'font-size:15px' }, null, 'a2-t');
    hl.textContent = 'h(a)'; off(hl, 1);
    const m = S.mem; if (m.sent == null) m.sent = 0;

    function landed() { off(trace, 0); off(pa, 0); off(hl, 0); }
    function send() {
      m.sent++;
      hero.classList.add('a2-live'); off(hero, 0); hero.style.opacity = '1'; tr(hero, bx, 24);
      void hero.getBoundingClientRect(); hero.classList.remove('a2-live');
      S.later(function () { tr(hero, bx, by); }, 30);
      S.later(function () { hero.style.opacity = '0'; }, 780);
      S.later(function () { landed(); ping(pa); S.snd('land'); }, 900);
      if (m.sent > 1) S.note('Sent ' + m.sent + ' times. h(a) is always the same position.');
    }
    const sendBtn = S.btn('SEND IT AGAIN', send); sendBtn.hidden = true;

    return [
      function () {
        off(rowG, 0);
        S.cap(P('We need to estimate how many different elements have appeared.') +
              P('But remembering every element is too expensive.', 1));
      },
      function () {
        off(rowG, 1); off(ax, 0);
        S.cap(P('What if every possible element had a ' + '<b>numerical address</b>' + '?') +
              P('A position on a line.', 1));
      },
      function () {
        off(box, 0);
        S.cap(P('Send an element through a black box ' + I('h') + '. It comes out as a point on the number line.'));
        if (S.instant) { landed(); off(hero, 1); } else { S.later(send, 500); }
      },
      function () {
        S.cap(P('This is a <b>hash function</b>:') +
              mth(row(mi('h'), mo(':'), mo('['), mi('m'), mo(']'), mo('\u27F6'), mo('['), mi('M'), mo(']')), true) +
              P('It maps each possible element to one of ' + I('M') + ' hash values: a position in a known range.', 1));
        landed();
      },
      function () {
        sendBtn.hidden = false;
        S.cap(P('Send the same element through again: it lands at exactly the same position.') +
              P('The same input always receives the same hash value.', 1));
      }
    ];
  }

  /* ---- 2. ONE POINT PER DIFFERENT ELEMENT -------------------------------- */

  function sc2(S) {
    const W = S.W, H = S.H, ay = Math.round(H * 0.74), cy = Math.round(H * 0.08), ch = 34;
    axis(S, ay, 'hash range');
    const cw = Math.max(26, Math.min(46, Math.floor((W - 2 * S.m) / 8) - 6)), gap = 6;
    const sx = (W - (8 * cw + 7 * gap)) / 2 + cw / 2;
    const cx = function (i) { return sx + i * (cw + gap); };
    const trg = S.el('g');
    const pts = {};
    NAMES.forEach(function (l) { pts[l] = mkPoint(S, S.g, S.X(HASHU[l]), ay, l); off(pts[l], 1); });
    const chips = STREAM.map(function (l, i) {
      const g = S.el('g', null, null, 'a2-chip a2-t'); tr(g, cx(i), cy);
      S.el('rect', { x: -cw / 2, y: 0, width: cw, height: ch }, g);
      const t = S.el('text', { x: 0, y: 22, 'text-anchor': 'middle' }, g); t.textContent = l;
      const tg = S.el('text', { x: 0, y: ch + 13, 'text-anchor': 'middle' }, g, 'a2-tag'); tg.textContent = String(i + 1);
      return g;
    });
    const rd = S.read(true);
    const pills = [
      S.pill(rd, 'arrivals<b>8</b>'),
      S.pill(rd, 'distinct elements<b>5</b>', 'is-amber'),
      S.pill(rd, 'hash positions<b>5</b>')
    ];
    pills.forEach(function (p) { off(p, 1); });
    const m = S.mem;
    let seen = {}, timer = 0;

    function clearVis() {
      chips.forEach(function (c) { c.classList.remove('is-cur', 'is-done'); });
      NAMES.forEach(function (l) { off(pts[l], 1); pts[l].classList.remove('is-in'); });
      while (trg.firstChild) trg.removeChild(trg.firstChild);
      seen = {};
    }
    function stepI(i, animate) {
      const l = STREAM[i];
      chips.forEach(function (c, j) { cls(c, 'is-cur', j === i); cls(c, 'is-done', j < i); });
      const first = !seen[l]; seen[l] = 1;
      const x2 = S.X(HASHU[l]), y1 = cy + ch, y2 = ay - 10, ym = (y1 + y2) / 2;
      const p = S.el('path', { d: 'M ' + cx(i) + ' ' + y1 + ' C ' + cx(i) + ' ' + ym + ' ' + x2 + ' ' + ym + ' ' + x2 + ' ' + y2 }, trg, 'a2-trace a2-t');
      if (!first) { p.setAttribute('stroke-dasharray', '4 4'); p.style.stroke = 'var(--amber)'; }
      if (animate) { off(p, 1); S.later(function () { off(p, 0); }, 40); }
      off(pts[l], 0); pts[l].classList.add('is-in');
      if (animate) { ping(pts[l]); S.snd(first ? 'land' : 'repeat'); }
    }
    function stop() { if (timer) { S.stop(timer); timer = 0; } }
    function finish() {
      stop(); clearVis();
      for (let i = 0; i < 8; i++) stepI(i, false);
      chips.forEach(function (c) { c.classList.remove('is-cur'); c.classList.add('is-done'); });
      m.played = true;
    }
    function play() {
      stop(); clearVis();
      let i = 0;
      const next = function () {
        if (i >= 8) { chips.forEach(function (c) { c.classList.remove('is-cur'); c.classList.add('is-done'); }); timer = 0; return; }
        stepI(i, true); i++;
        timer = S.later(next, 950);
      };
      timer = S.later(next, 300);
    }
    const replay = S.btn('REPLAY STREAM', play); replay.hidden = true;
    const relabel = function (v) {
      NAMES.forEach(function (l, i) { pts[l].querySelector('text').textContent = v ? 'b' + SUBS[i] : l; });
    };

    return [
      function () {
        replay.hidden = false;
        S.cap(P('Here is a small stream of eight arrivals. Watch each one pass through ' + I('h') + ', in order.') +
              P('The first time an element appears it gets a point. A repeat traces back to the point it already has.', 1));
        if (S.instant) finish(); else play();
      },
      function () {
        finish(); replay.hidden = false;
        pills.forEach(function (p) { off(p, 0); });
        S.note('Idealised picture: collisions between different elements are ignored here.');
        S.cap(P('Eight arrivals, but only <b>five different elements</b>. One point for each.') +
              P('Repeats do not create new points.', 1));
      },
      function () {
        finish(); relabel(true);
        pills.forEach(function (p) { off(p, 0); });
        S.note('Idealised picture: collisions between different elements are ignored here.');
        S.cap(P('In general, call the distinct elements ' + mth(row(sub(mi('b'), mn('1')), mo(','), mo('\u2026'), mo(','), sub(mi('b'), mi('d')))) +
               '. Every occurrence of ' + mth(sub(mi('b'), mi('i'))) + ' lands on ' + mth(row(mi('h'), mo('('), sub(mi('b'), mi('i')), mo(')'))) +
               ', so a repeat never adds a new distinct hash value.') +
              P('We are counting points, not arrivals: the population is ' + I('d') + ', not ' + I('n') + '.', 1));
      }
    ];
  }

  /* ---- 3. A RANGE FILLS WITH POINTS -------------------------------------- */

  function sc3(S) {
    const m = S.mem; if (m.seed == null) m.seed = 11; if (m.d == null) m.d = 10;
    const W = S.W, H = S.H, ay = Math.round(H * 0.66), band = Math.round(H * 0.40), N = 120;
    axis(S, ay, '');
    const msz = S.el('text', { x: W / 2, y: ay + 42, 'text-anchor': 'middle' }, null, 'a2-axl'); msz.textContent = 'M possible hash values';
    let us = [];
    const pts = [];
    for (let i = 0; i < N; i++) { const g = mkPoint(S, S.g, 0, 0, null, 0, 3.5); off(g, 1); pts.push(g); }
    const rd = S.read(true);
    const pD = S.pill(rd, ''), pF = S.pill(rd, ''); off(pF, 1);
    let showF = false;
    const sl = S.slider('d', 3, N, 1, Math.max(3, m.d), function (v) { return 'd = ' + v; }, function (v) { setD(v); S.snd('step'); });
    const btn = S.btn('NEW ASSIGNMENT', function () { m.seed++; layout(); S.snd('land'); });
    sl.wrap.hidden = true; btn.hidden = true;

    function layout() {
      us = seq(m.seed, N).map(function (u) { return 0.02 + 0.96 * u; });
      pts.forEach(function (p, i) { tr(p, S.X(us[i]), ay - 12 - jit(i, m.seed) * band); });
      pills();
    }
    function pills() {
      pD.innerHTML = I('d') + ' = <b>' + m.d + '</b> distinct elements, ' + I('M') + ' fixed';
      const c = [0, 0, 0, 0, 0];
      for (let i = 0; i < m.d; i++) c[Math.min(4, Math.floor(us[i] * 5))]++;
      pF.innerHTML = 'points in each fifth of the range<b>' + c.join(' \u00B7 ') + '</b>';
      off(pF, !showF || m.d === 0);
    }
    function setD(n) {
      m.d = n;
      pts.forEach(function (p, i) { off(p, i >= n); });
      pills();
    }
    layout(); setD(0);

    return [
      function () {
        S.cap(P('The hash range is known: it holds ' + I('M') + ' possible values. Every hash value is a position on this line.'));
      },
      function () {
        setD(10); sl.set(10);
        S.cap(P('<b>Uniform hashing</b>: each fixed element is equally likely to land on any hash value in the range. No region is favoured in advance.'));
      },
      function () {
        sl.wrap.hidden = false; btn.hidden = false; setD(Math.max(10, m.d)); sl.set(m.d);
        S.note('Vertical offsets are only for visibility: only the horizontal position matters.');
        S.cap(P('Keep the range fixed and let the number of distinct elements grow. The same range fills up.') +
              P('More distinct elements, a denser field of points. Drag the slider.', 1));
      },
      function () {
        showF = true; pills();
        S.cap(P('Draw a new assignment: it looks different every time, and it is rarely perfectly even.') +
              P('Uniform means no favoured region, not equal spacing. This is intuition, not a proof.', 1));
      }
    ];
  }

  /* ---- 4. THE THRESHOLD -------------------------------------------------- */

  function sc4(S) {
    const m = S.mem; if (m.seed == null) m.seed = 21; if (m.u == null) m.u = 0.35;
    const W = S.W, H = S.H, d = 30, ay = Math.round(H * 0.30), band = Math.round(H * 0.13), c0 = ay + 36, c1 = H - 28;
    const yc = function (c) { return c1 - (c / d) * (c1 - c0); };
    axis(S, ay, '');
    const shade = S.el('rect', { x: S.x0, y: ay - band - 16, width: 0, height: band + 22 }, null, 'a2-shade a2-live a2-off');
    const pts = [];
    for (let i = 0; i < d; i++) pts.push(mkPoint(S, S.g, 0, 0, null, 0, 3.5));
    const cg = S.el('g', null, null, 'a2-t a2-off');
    S.el('line', { x1: S.x0, y1: c1, x2: S.x1, y2: c1 }, cg, 'a2-tick');
    S.el('line', { x1: S.x0, y1: c0, x2: S.x0, y2: c1 }, cg, 'a2-tick');
    const l0 = S.el('text', { x: S.x0 - 6, y: c1 + 4, 'text-anchor': 'end' }, cg, 'a2-axl'); l0.textContent = '0';
    const ld = S.el('text', { x: S.x0 - 6, y: c0 + 4, 'text-anchor': 'end', style: SERIF + 'font-size:15px' }, cg, 'a2-axl'); ld.textContent = 'd';
    const step = S.el('path', { d: '' }, cg, 'a2-step');
    const legR = S.el('text', { x: S.x0 + 12, y: c0 + 12 }, cg, 'a2-legR'); legR.textContent = 'realised count X(x)';
    const lineE = S.el('line', { x1: S.x0, y1: c1, x2: S.x1, y2: c0 }, null, 'a2-lin a2-t a2-off');
    const legE = S.el('text', { x: S.x0 + 12, y: c0 + 28 }, null, 'a2-legE a2-t a2-off'); legE.textContent = 'expected count d\u00B7x/M';
    const thr = S.el('g', null, null, 'a2-thr a2-live a2-off');
    S.el('line', { x1: 0, y1: ay - band - 22, x2: 0, y2: c1 }, thr, 'a2-thrl');
    S.el('circle', { cx: 0, cy: ay, r: 7 }, thr, 'a2-thrh');
    const tl = S.el('text', { x: 0, y: ay - band - 28, 'text-anchor': 'middle', style: SERIF + 'font-size:17px;fill:var(--ivory)' }, thr); tl.textContent = 'x';
    const mR = S.el('circle', { r: 6 }, null, 'a2-mreal a2-live a2-off');
    const mE = S.el('circle', { r: 6 }, null, 'a2-mexp a2-live a2-off');
    const rd = S.read();
    const pFrac = S.pill(rd, ''), pReal = S.pill(rd, '', 'is-amber'), pExp = S.pill(rd, '');
    [pFrac, pReal, pExp].forEach(function (p) { off(p, 1); });
    let us = [];

    function setU(u) {
      u = Math.max(0, Math.min(1, u)); m.u = u;
      const x = S.X(u); tr(thr, x, 0);
      shade.setAttribute('width', Math.max(0, x - S.x0));
      let r = 0;
      pts.forEach(function (p, i) { const inn = us[i] < u; if (inn) r++; cls(p, 'is-in', m.hl && inn); });
      tr(mR, x, yc(r)); tr(mE, x, yc(d * u));
      pFrac.innerHTML = I('x') + '/' + I('M') + '<b>' + u.toFixed(2) + '</b>';
      pReal.innerHTML = 'realised ' + I('X') + '<sub>' + I('x') + '</sub><b>' + r + '</b>';
      pExp.innerHTML = 'expected ' + I('d') + '\u00B7' + I('x') + '/' + I('M') + '<b>' + (d * u).toFixed(1) + '</b>';
    }
    function layout() {
      us = seq(m.seed, d).map(function (u) { return 0.02 + 0.96 * u; });
      pts.forEach(function (p, i) { tr(p, S.X(us[i]), ay - 12 - jit(i, m.seed) * band); });
      const s = us.slice().sort(function (a, b) { return a - b; });
      let dd = 'M ' + S.x0 + ' ' + c1;
      s.forEach(function (u, i) { dd += ' H ' + S.X(u) + ' V ' + yc(i + 1); });
      dd += ' H ' + S.x1;
      step.setAttribute('d', dd);
      setU(m.u);
    }
    const sl = S.slider('x', 0, 1000, 1, Math.round(m.u * 1000), function (v) { return (v / 1000).toFixed(2); },
      function (v) { setU(v / 1000); tick(); });
    sl.wrap.hidden = true;
    const nb = S.btn('NEW ASSIGNMENT', function () { m.seed++; layout(); S.snd('land'); }); nb.hidden = true;
    let lastTick = 0;
    function tick() { const t = performance.now(); if (t - lastTick > 110) { lastTick = t; S.snd('step'); } }

    let dragging = false;
    const mv = function (e) {
      const r = S.svg.getBoundingClientRect();
      setU((e.clientX - r.left - S.x0) / (S.x1 - S.x0));
      sl.set(Math.round(m.u * 1000)); tick();
    };
    S.on(S.svg, 'pointerdown', function (e) {
      if (!m.drag) return;
      dragging = true;
      try { S.svg.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      mv(e);
    });
    S.on(S.svg, 'pointermove', function (e) { if (dragging) mv(e); });
    const end = function () { dragging = false; };
    S.on(S.svg, 'pointerup', end); S.on(S.svg, 'pointercancel', end);

    layout();

    return [
      function () {
        m.hl = false; setU(m.u);
        off(thr, 0); off(shade, 0);
        S.cap(P('Draw a threshold ' + I('x') + ' across the hash range. It splits the range into a left part and a right part.'));
      },
      function () {
        m.hl = true; m.drag = true; S.svg.classList.add('is-drag'); setU(m.u);
        off(cg, 0); off(mR, 0); off(pReal, 0); sl.wrap.hidden = false;
        S.cap(P('Let ' + mth(sub(mi('X'), mi('x'))) + ' count the distinct elements whose hash value lies below ' + I('x') + '.') +
              P('Drag ' + I('x') + ': the count climbs in steps, one point at a time. This is the realised count for this one assignment.', 1));
      },
      function () {
        off(pFrac, 0);
        S.cap(P('The fraction of the range that lies below ' + I('x') + ' is ' + mth(frac(mi('x'), mi('M'))) + '.') +
              P('A threshold a third of the way along covers about a third of the range.', 1));
      },
      function () {
        off(lineE, 0); off(legE, 0); off(mE, 0); off(pExp, 0);
        S.snd('keep');
        S.cap(P('If each of the ' + I('d') + ' elements is equally likely to land anywhere, the chance that it falls below ' + I('x') + ' is ' + I('x') + '/' + I('M') + '. Adding up the ' + I('d') + ' chances gives') +
              mth(F_EXP, true) +
              P('Linearity of expectation is enough here. The \u2248 keeps finite-range rounding honest.', 1));
      },
      function () {
        nb.hidden = false;
        S.cap(P('The amber steps wobble around the green line, and they look different for every assignment.') +
              P('The realised count is not equal to its expectation in every run. Try a new assignment.', 1));
      }
    ];
  }

  /* ---- 5. THE QUESTION WE CANNOT ASK ------------------------------------- */

  function sc5(S) {
    const m = S.mem; if (m.t == null) m.t = 3;
    const W = S.W, H = S.H, d = 18, ay = Math.round(H * 0.66), band = Math.round(H * 0.30), sy = 40;
    axis(S, ay, '');
    const us = seq(5, d).map(function (u) { return 0.03 + 0.94 * u; });
    const order = us.map(function (u, i) { return i; }).sort(function (a, b) { return us[a] - us[b]; });
    const lineG = S.el('g'), slotG = S.el('g');
    const pts = us.map(function (u, i) { return mkPoint(S, S.g, S.X(u), ay - 12 - jit(i, 5) * band, null, 0, 4); });
    const thr = S.el('g', null, null, 'a2-thr is-unk a2-t a2-off'); tr(thr, S.X(0.4), 0);
    S.el('line', { x1: 0, y1: ay - band - 22, x2: 0, y2: ay + 6 }, thr, 'a2-thrl');
    S.el('circle', { cx: 0, cy: ay, r: 7 }, thr, 'a2-thrh');
    const tq = S.el('text', { x: 0, y: ay - band - 28, 'text-anchor': 'middle', style: SERIF + 'font-size:17px;fill:var(--amber)' }, thr); tq.textContent = 'x = ?';

    const ovm = el('div', 'a2-math'); S.ov.appendChild(ovm);
    const lead = el('p', 'a2-lead', 'Match the expected count to the budget t'); ovm.appendChild(lead);
    const L1 = el('div', 'a2-ml'); L1.innerHTML = mth(row(E_X, APX, DX_M, APX, mi('t')), true); ovm.appendChild(L1);
    const L2 = el('div', 'a2-ml'); L2.innerHTML = mth(row(IMP, mi('x'), APX, TM_D), true); ovm.appendChild(L2);
    off(L1, 1); off(L2, 1);

    const rd = S.read();
    const pT = S.pill(rd, ''), pD = S.pill(rd, '<i class="a2-unk">d</i> = <b class="a2-unk">?</b>', 'is-amber');
    off(pT, 1); off(pD, 1);

    function drawSlots() {
      while (lineG.firstChild) lineG.removeChild(lineG.firstChild);
      while (slotG.firstChild) slotG.removeChild(slotG.firstChild);
      const t = m.t, sz = Math.min(34, Math.floor((S.x1 - S.x0 - 6 * (t - 1)) / t));
      const idx = order.slice(0, t);
      for (let i = 0; i < t; i++) {
        const x = S.x0 + i * (sz + 6), pi = idx[i];
        S.el('line', { x1: x + sz / 2, y1: sy + sz, x2: S.X(us[pi]), y2: ay - 12 - jit(pi, 5) * band - 6 }, lineG, 'a2-trace');
        const g = S.el('g', null, slotG, 'a2-slot is-empty'); tr(g, x, sy);
        S.el('rect', { width: sz, height: sz }, g);
        const tx = S.el('text', { x: sz / 2, y: sz / 2 + 6, 'text-anchor': 'middle' }, g); tx.textContent = String(i + 1);
      }
      pts.forEach(function (p, i) { cls(p, 'is-keep', m.slots && idx.indexOf(i) >= 0); });
      pT.innerHTML = I('t') + ' = <b>' + t + '</b> chosen budget';
    }
    const grp = S.group(); grp.hidden = true;
    const gl = el('span', 'a2-sl-l', 'BUDGET t'); grp.appendChild(gl);
    const tb = [2, 3, 4, 5, 6].map(function (v) {
      const b = el('button', 'a2-btn', String(v)); b.type = 'button';
      b.setAttribute('aria-label', 'Budget t equals ' + v);
      b.setAttribute('aria-pressed', String(v === m.t));
      b.addEventListener('click', function () {
        m.t = v; tb.forEach(function (x, i) { x.setAttribute('aria-pressed', String(i + 2 === v)); });
        drawSlots(); S.snd('keep');
      });
      grp.appendChild(b); return b;
    });
    m.slots = false; drawSlots(); off(lineG, 1); off(slotG, 1);
    lineG.setAttribute('class', 'a2-t'); slotG.setAttribute('class', 'a2-t');

    return [
      function () {
        S.svg.classList.add('is-dim');
        off(L1, 0);
        S.cap(P('Suppose we wanted about ' + I('t') + ' hash values below our threshold ' + I('x') + '.') +
              P('We could match the expected count to ' + I('t') + '.', 1));
      },
      function () {
        off(L2, 0);
        S.cap(P('Solve for ' + I('x') + ': the ideal threshold would be') + mth(row(mi('x'), APX, TM_D), true));
      },
      function () {
        S.svg.classList.remove('is-dim'); off(L1, 1); off(L2, 1); off(lead, 1);
        off(thr, 0); off(pD, 0); S.snd('drop');
        S.cap(P('But <i class="a2-unk">d</i> is exactly what we are trying to estimate.') +
              mth(row(mi('x'), APX, frac(row(mi('t'), mi('M')), '<mi class="a2-unk">d</mi>')), true) +
              P('To place the ideal threshold we would need the answer already.', 1));
      },
      function () {
        off(thr, 1); off(slotG, 0); off(lineG, 0); off(pT, 0); grp.hidden = false;
        m.slots = true; drawSlots(); S.snd('keep');
        S.cap(P('Reverse the question. Instead of choosing ' + I('x') + ' with an unknown ' + I('d') + ', choose <b>how many values we can afford to keep</b>.') +
              P(I('t') + ' is a storage budget that we choose. It is not the unknown distinct count ' + I('d') + '. The ' + I('t') + ' leftmost values are kept.', 1));
      }
    ];
  }

  /* ---- 6. KEEP ONLY THE LEFTMOST ----------------------------------------- */

  function sc6(S) {
    const m = S.mem; if (m.k == null) m.k = 0;
    const W = S.W, H = S.H, T = T6, R = 64;
    const cw = Math.max(26, Math.min(44, Math.floor((W - 2 * S.m) / 8) - 4)), gap = 4, ch = 32, cy = 34;
    const sx = (W - (8 * cw + 7 * gap)) / 2 + cw / 2, ay = Math.round(H * 0.56);
    axis(S, ay, 'illustrative hash values', String(R));
    const sortedAll = HV.slice().sort(function (a, b) { return a - b; });
    const vml = S.el('g', null, null, 'a2-vm a2-t'); off(vml, 1);
    S.el('line', { x1: 0, y1: ay - 72, x2: 0, y2: ay + 8 }, vml, 'a2-vml');
    const vt = S.el('text', { x: 0, y: ay - 78, 'text-anchor': 'middle' }, vml); vt.textContent = 'v';
    const pts = HV.map(function (val) {
      const r = sortedAll.indexOf(val);
      const p = mkPoint(S, S.g, S.X(val / R), ay, String(val), -14 - (r % 2) * 14); off(p, 1); return p;
    });
    const chips = HV.map(function (val, i) {
      const g = S.el('g', null, null, 'a2-chip a2-t'); tr(g, sx + i * (cw + gap), cy);
      S.el('rect', { x: -cw / 2, y: 0, width: cw, height: ch }, g);
      const t = S.el('text', { x: 0, y: 21, 'text-anchor': 'middle' }, g); t.textContent = String(val);
      const tg = S.el('text', { x: 0, y: ch + 13, 'text-anchor': 'middle' }, g, 'a2-tag'); tg.textContent = String(i + 1);
      return g;
    });
    const sz = 38, sg = 8, sy = ay + 50, sx0 = W / 2 - (T * sz + (T - 1) * sg) / 2;
    const hlab = S.el('text', { x: sx0 - 10, y: sy + sz / 2 + 6, 'text-anchor': 'end', style: SERIF + 'font-size:20px' }); hlab.textContent = 'H =';
    const slots = [];
    for (let j = 0; j < T; j++) {
      const g = S.el('g', null, null, 'a2-slot a2-t is-empty'); tr(g, sx0 + j * (sz + sg), sy);
      S.el('rect', { width: sz, height: sz }, g);
      const tx = S.el('text', { x: sz / 2, y: sz / 2 + 6, 'text-anchor': 'middle' }, g); tx.textContent = '\u2014';
      const vv = S.el('text', { x: sz / 2, y: sz + 16, 'text-anchor': 'middle' }, g, 'a2-slotv');
      slots.push({ g: g, tx: tx, vv: vv });
    }
    const rd = S.read();
    const pInv = S.pill(rd, I('H') + ' = the ' + I('t') + ' smallest distinct hash values seen so far'); off(pInv, 1);

    function stepCap(k) {
      const st = STATES[k - 1], r = st.r, mx = st.act.split(':')[1];
      let a;
      if (st.act === 'insert') a = 'Fewer than ' + I('t') + ' = ' + T + ' values are retained, so <b>insert</b> ' + r + '.';
      else if (st.act === 'dup') a = r + ' is already retained: nothing changes.';
      else if (st.act.indexOf('replace') === 0) a = 'The set is full and its largest value is ' + mx + '. Since ' + r + ' &lt; ' + mx + ', <b>remove ' + mx + '</b> and insert ' + r + '.';
      else a = 'The largest retained value is ' + mx + ' and ' + r + ' &gt; ' + mx + ', so it lies beyond the boundary: <b>discard</b> it.';
      return P('<b>Arrival ' + k + ': r = ' + r + '.</b> ' + a) + P(I('H') + ' = {' + st.set.join(', ') + '}', 1);
    }
    function render(k, animate, noCap) {
      m.k = k;
      chips.forEach(function (c, i) { cls(c, 'is-cur', i === k - 1); cls(c, 'is-done', i < k - 1); });
      const st = k > 0 ? STATES[k - 1] : null, set = st ? st.set : [];
      pts.forEach(function (p, i) {
        if (i < k) { off(p, 0); const inn = set.indexOf(HV[i]) >= 0; cls(p, 'is-keep', inn); cls(p, 'is-drop', !inn); }
        else { off(p, 1); cls(p, 'is-keep', 0); cls(p, 'is-drop', 0); }
      });
      if (animate && k > 0) ping(pts[k - 1]);
      if (set.length === T) { tr(vml, S.X(set[T - 1] / R), 0); off(vml, 0); } else off(vml, 1);
      slots.forEach(function (s, j) {
        const val = set[j];
        s.tx.textContent = val != null ? String(val) : '\u2014';
        cls(s.g, 'is-empty', val == null); cls(s.g, 'is-full', set.length === T);
        cls(s.g, 'is-new', !!st && val === st.r && st.act.indexOf('discard') !== 0 && st.act !== 'dup');
        s.vv.textContent = (j === T - 1 && set.length === T) ? 'v' : '';
      });
      if (animate && st) S.snd(st.act.indexOf('discard') === 0 ? 'drop' : 'keep');
      if (!noCap) S.cap(k === 0 ? P('Press <b>Next arrival</b>, or <b>Play</b> to watch.') : stepCap(k));
      buttons();
    }

    let autoT = 0;
    function stopAuto() { if (autoT) { S.stop(autoT); autoT = 0; } m.playing = false; buttons(); }
    function advance() { if (m.k < 8) { render(m.k + 1, true); if (m.k === 8) done(); } }
    function done() { S.unlock('s6'); m.playing = false; buttons(); }
    function schedule() {
      autoT = S.later(function () {
        advance();
        if (m.k < 8 && m.playing) schedule(); else { autoT = 0; m.playing = false; buttons(); }
      }, 2300);
    }
    const bNext = S.btn('NEXT ARRIVAL', function () { stopAuto(); advance(); });
    const bPlay = S.btn('PLAY', function () {
      if (m.playing) { stopAuto(); return; }
      if (m.k >= 8) return;
      m.playing = true; buttons(); schedule();
    });
    const bRe = S.btn('REPLAY', function () { stopAuto(); render(0, false); });
    [bNext, bPlay, bRe].forEach(function (b) { b.hidden = true; });
    bPlay.setAttribute('aria-pressed', 'false');
    function buttons() {
      bNext.disabled = m.k >= 8;
      bPlay.disabled = m.k >= 8;
      bPlay.textContent = m.playing ? 'PAUSE' : 'PLAY';
      bPlay.setAttribute('aria-pressed', String(!!m.playing));
      bRe.disabled = m.k === 0;
    }

    return [
      function () {
        m.k = 0; m.playing = false; render(0, false, true);
        S.cap(P('Now the real streaming rule. Fix ' + I('t') + ' = ' + T + ' and let these hash values arrive in this order. The input is never sorted.') +
              '<ul class="a2-rule"><li>Fewer than ' + I('t') + ' values retained: insert the new value.</li>' +
              '<li>Otherwise compare it with the largest retained value.</li>' +
              '<li>If it is smaller: remove the largest and insert it.</li>' +
              '<li>If not: discard it.</li></ul>');
      },
      function () {
        if (!S.final) m.k = 8;
        off(pInv, 0); [bNext, bPlay, bRe].forEach(function (b) { b.hidden = false; });
        S.gate('s6', 'Step through all eight arrivals to continue.');
        render(m.k, false);
        if (m.k >= 8) S.unlock('s6');
        if (m.playing && m.k < 8) schedule();
      },
      function () {
        stopAuto(); off(pInv, 0);
        bNext.hidden = true; bPlay.hidden = true; bRe.hidden = false;
        render(8, !S.instant, true); S.unlock('s6');
        const sv = slots[T - 1].g; ping(pts[HV.indexOf(12)]);
        void sv;
        S.cap(P('After all eight arrivals, ' + I('H') + ' = {5, 8, 12}. The largest retained value is <b>' + I('v') + ' = 12</b>: the ' + T + 'rd smallest hash value seen.') +
              P('This is a deterministic illustration of the rule, not a statistical experiment. ' + I('H') + ' is not a random sample of the stream\u2019s elements.', 1));
      }
    ];
  }

  /* ---- 7. THE BOUNDARY TELLS A STORY ------------------------------------- */

  function sc7(S) {
    const m = S.mem; if (!m.pop) m.pop = 'few';
    const W = S.W, H = S.H, t = 5, NF = 12, NM = 60, ay = Math.round(H * 0.64), band = Math.round(H * 0.34);
    axis(S, ay, '');
    const us = seq(7, NM).map(function (u) { return 0.02 + 0.96 * u; });
    const pts = us.map(function (u, i) { const p = mkPoint(S, S.g, S.X(u), ay - 12 - jit(i, 7) * band, null, 0, 4); return p; });
    const vml = S.el('g', null, null, 'a2-vm a2-t'); off(vml, 1);
    S.el('line', { x1: 0, y1: ay - band - 24, x2: 0, y2: ay + 8 }, vml, 'a2-vml');
    const vt = S.el('text', { x: 0, y: ay - band - 30, 'text-anchor': 'middle', style: SERIF + 'font-size:18px' }, vml); vt.textContent = 'v';
    const thr = S.el('g', null, null, 'a2-thr a2-t'); tr(thr, S.X(0.5), 0); off(thr, 1);
    S.el('line', { x1: 0, y1: ay - band - 24, x2: 0, y2: ay + 8 }, thr, 'a2-thrl');
    S.el('circle', { cx: 0, cy: ay, r: 7 }, thr, 'a2-thrh');
    const tl = S.el('text', { x: 0, y: ay - band - 30, 'text-anchor': 'middle', style: SERIF + 'font-size:18px;fill:var(--ivory)' }, thr); tl.textContent = 'x';
    const rd = S.read();
    const pT = S.pill(rd, I('t') + ' = <b>' + t + '</b> fixed'), pD = S.pill(rd, '', 'is-amber'), pV = S.pill(rd, '');
    m.showKeep = !!m.showKeep;

    function setPop(pop) {
      m.pop = pop;
      const n = pop === 'few' ? NF : NM;
      pts.forEach(function (p, i) { off(p, i >= n); });
      const sorted = us.slice(0, n).map(function (u, i) { return [u, i]; }).sort(function (a, b) { return a[0] - b[0]; });
      const keep = {}; sorted.slice(0, t).forEach(function (e) { keep[e[1]] = 1; });
      const v = sorted[t - 1][0];
      pts.forEach(function (p, i) { cls(p, 'is-keep', m.showKeep && i < n && keep[i]); });
      tr(vml, S.X(v), 0);
      if (m.morphed) tr(thr, S.X(v), 0);
      pD.innerHTML = I('d') + ' = <b>' + n + '</b> (' + (pop === 'few' ? 'fewer' : 'more') + ')';
      pV.innerHTML = I('v') + '/' + I('M') + '<b>' + v.toFixed(2) + '</b>';
      bF.setAttribute('aria-pressed', String(pop === 'few')); bM.setAttribute('aria-pressed', String(pop === 'many'));
    }
    const grp = S.group(); grp.hidden = true;
    grp.appendChild(el('span', 'a2-sl-l', 'POPULATION'));
    const bF = el('button', 'a2-btn', 'FEWER'); bF.type = 'button';
    const bM = el('button', 'a2-btn', 'MORE'); bM.type = 'button';
    bF.addEventListener('click', function () { setPop('few'); S.snd('step'); });
    bM.addEventListener('click', function () { setPop('many'); S.snd('keep'); });
    grp.append(bF, bM);

    const ovm = el('div', 'a2-math'); S.ov.appendChild(ovm);
    const A1 = el('div', 'a2-ml'); A1.innerHTML = mth(row(E_X, APX, DX_M)) + mth(row(E_X, APX, mi('t')));
    const A2 = el('div', 'a2-ml'); A2.innerHTML = mth(row(DX_M, APX, mi('t'), IMP, mi('x'), APX, TM_D));
    const A3 = el('div', 'a2-ml'); A3.innerHTML = mth(row(mi('v'), APX, TM_D, IMP, mi('d'), APX, TM_V));
    [A1, A2, A3].forEach(function (a) { ovm.appendChild(a); off(a, 1); });

    return [
      function () {
        m.showKeep = true; grp.hidden = false; setPop('few'); off(vml, 0);
        S.cap(P('Fix the budget ' + I('t') + ' = ' + t + ' and keep the ' + I('t') + ' smallest hash values. With few distinct elements the points are sparse, so we must travel far to the right to collect ' + I('t') + ' of them.') +
              P(I('v') + ' is the largest retained value. Switch between the two populations: ' + I('M') + ' and ' + I('t') + ' do not change.', 1));
      },
      function () {
        setPop('many'); S.snd('keep');
        S.cap(P('With many distinct elements the same range is crowded. The first ' + I('t') + ' values pile up near zero, so ' + I('v') + ' sits much closer to 0.'));
      },
      function () {
        m.morphed = true; off(vml, 1); off(thr, 0); tr(thr, S.X(us.slice(0, m.pop === 'few' ? NF : NM).slice().sort(function (a, b) { return a - b; })[t - 1]), 0);
        if (S.instant) tl.textContent = 'v'; else S.later(function () { tl.textContent = 'v'; }, 700);
        S.snd('land');
        S.cap(P('Recall the threshold ' + I('x') + ' from before. The observed boundary ' + I('v') + ' plays that role.') +
              P(I('v') + ' is the threshold that leaves about ' + I('t') + ' hash values to its left.', 1));
      },
      function () {
        grp.hidden = true; tl.textContent = 'v'; S.svg.classList.add('is-dim');
        off(A1, 0); if (S.instant) off(A2, 0); else S.later(function () { off(A2, 0); }, 900);
        S.cap(P('Matching the expected count to ' + I('t') + ' gives the ideal threshold:') +
              P(I('x') + ' \u2248 ' + I('t') + I('M') + '/' + I('d') + '.', 1));
      },
      function () {
        S.svg.classList.add('is-dim'); off(A1, 0); off(A2, 0); off(A3, 0); S.snd('ok');
        S.cap(P('Now ' + I('v') + ' is the observed threshold: take ' + I('x') + ' = ' + I('v') + ' and solve for ' + I('d') + '.') +
              P('This is a threshold-scale argument: an approximation, not an exact identity.', 1));
      }
    ];
  }

  /* ---- 8. THE THINNEST SLICE --------------------------------------------- */

  function sc8(S) {
    const m = S.mem;
    const W = S.W, H = S.H, d = 30, t = 5, ay = Math.round(H * 0.68), band = Math.round(H * 0.28);
    const us = seq(3, d).map(function (u) { return 0.03 + 0.94 * u; });
    axis(S, ay, '');
    const msz = S.el('text', { x: W / 2, y: ay + 42, 'text-anchor': 'middle' }, null, 'a2-axl a2-t'); msz.textContent = 'a range of size M'; off(msz, 1);
    const trg = S.el('g');
    const pos = us.map(function (u, i) { return [S.X(u), ay - 12 - jit(i, 3) * band]; });
    const pts = pos.map(function (p) { const g = mkPoint(S, S.g, p[0], p[1], null, 0, 4); off(g, 1); return g; });
    const tg = 3, dx = pos[tg][0], dy = pos[tg][1];
    const c1 = tok(S, S.g, 'b', dx - 26, 26, true), c2 = tok(S, S.g, 'b', dx + 26, 26, true);
    [dx - 26, dx + 26].forEach(function (x) {
      const q = S.el('path', { d: 'M ' + x + ' 42 C ' + x + ' ' + (dy / 2 + 20) + ' ' + dx + ' ' + (dy / 2 + 20) + ' ' + dx + ' ' + (dy - 8) }, trg, 'a2-trace a2-t');
      q.style.stroke = 'var(--hi)'; off(q, 1); q.classList.add('dup');
    });
    const thr = S.el('g', null, null, 'a2-thr a2-t'); tr(thr, S.X(0.3), 0); off(thr, 1);
    S.el('line', { x1: 0, y1: ay - band - 24, x2: 0, y2: ay + 6 }, thr, 'a2-thrl');
    S.el('circle', { cx: 0, cy: ay, r: 7 }, thr, 'a2-thrh');
    const tl = S.el('text', { x: 0, y: ay - band - 30, 'text-anchor': 'middle', style: SERIF + 'font-size:17px;fill:var(--ivory)' }, thr); tl.textContent = 'x';
    const shade = S.el('rect', { x: S.x0, y: ay - band - 16, width: S.X(0.3) - S.x0, height: band + 22 }, null, 'a2-shade a2-t'); off(shade, 1);
    const sorted = us.slice().sort(function (a, b) { return a - b; });
    const keepIdx = us.map(function (u, i) { return i; }).sort(function (a, b) { return us[a] - us[b]; }).slice(0, t);
    const vml = S.el('g', null, null, 'a2-vm a2-t'); tr(vml, S.X(sorted[t - 1]), 0); off(vml, 1);
    S.el('line', { x1: 0, y1: ay - band - 24, x2: 0, y2: ay + 8 }, vml, 'a2-vml');
    const vt = S.el('text', { x: 0, y: ay - band - 30, 'text-anchor': 'middle', style: SERIF + 'font-size:18px' }, vml); vt.textContent = 'v';
    const rd = S.read(true);
    const pE = S.pill(rd, 'expected below ' + I('x') + ': ' + mth(F_EXP)), pU = S.pill(rd, I('d') + ' = <b>?</b>', 'is-amber'), pT = S.pill(rd, I('t') + ' = <b>' + t + '</b>');
    [pE, pU, pT].forEach(function (p) { off(p, 1); });
    const dups = trg.querySelectorAll('.dup');

    const c7 = el('div', 'a2-card a2-off'), c8 = el('div', 'a2-card a2-off'), c9 = el('div', 'a2-card a2-off');
    c7.innerHTML = P('Invert the relationship:', 1).replace('class="a2-dim"', 'class="a2-fine"') +
      '<div class="a2-formula">' + mth(row(DTILDE, mo('='), TM_V)) + '</div>' +
      '<dl class="a2-defs">' +
      '<dt>' + mth(mi('d')) + '</dt><dd>the unknown number of distinct elements</dd>' +
      '<dt>' + mth(mi('t')) + '</dt><dd>how many of the smallest distinct hash values we retain</dd>' +
      '<dt>' + mth(mi('M')) + '</dt><dd>the size of the hash-value range</dd>' +
      '<dt>' + mth(mi('v')) + '</dt><dd>the largest retained value: the <i>t</i>-th smallest hash value</dd>' +
      '<dt>' + mth(DTILDE) + '</dt><dd>our estimate of the distinct-element count</dd></dl>' +
      '<p class="a2-fine">If fewer than <i>t</i> distinct hash values have been seen, all of them are retained and the count can be reported exactly (assuming no hash collisions). The estimate applies once <i>t</i> values are retained.</p>';
    c8.innerHTML = '<p class="a2-q">If <i>d</i> grows while <i>t</i> and <i>M</i> stay fixed, what happens to <i>v</i>?</p>';
    const opts = el('div', 'a2-opts'); c8.appendChild(opts);
    const fb = el('p', 'a2-fb'); fb.setAttribute('aria-live', 'polite'); c8.appendChild(fb);
    const OP = [['It tends to become smaller', 1], ['It tends to become larger', 0], ['It stays the same', 0]];
    const obtn = OP.map(function (o) {
      const b = el('button', 'a2-opt', o[0]); b.type = 'button';
      b.addEventListener('click', function () {
        if (o[1]) {
          b.classList.add('is-right'); fb.className = 'a2-fb is-right';
          fb.textContent = 'Yes. More distinct hash values make the range denser, so the t-th smallest tends to move closer to zero. Since the estimate is tM/v, a smaller v corresponds to a larger estimated d.';
          obtn.forEach(function (x) { x.disabled = true; });
          S.snd('ok'); S.unlock('s8');
        } else {
          b.classList.add('is-wrong'); fb.className = 'a2-fb is-wrong';
          fb.textContent = 'Not quite. Think about the density of points near zero: with more points, where do the first t of them tend to fall?';
          S.snd('bad');
        }
      });
      opts.appendChild(b); return b;
    });
    if (S.done('s8')) {
      obtn[0].classList.add('is-right'); fb.className = 'a2-fb is-right';
      fb.textContent = 'Yes. More distinct hash values make the range denser, so the t-th smallest tends to move closer to zero. Since the estimate is tM/v, a smaller v corresponds to a larger estimated d.';
      obtn.forEach(function (x) { x.disabled = true; });
    }
    c9.innerHTML = '<p class="a2-big">We have constructed the estimator.</p><div class="a2-formula">' + mth(row(DTILDE, mo('='), TM_V)) + '</div><p class="a2-big is-amber">But how accurate is it?</p>';
    [c7, c8, c9].forEach(function (c) { S.ov.appendChild(c); });
    const cards = function (a, b, c) { off(c7, !a); off(c8, !b); off(c9, !c); };

    return [
      function () {
        pts.forEach(function (p) { off(p, 0); });
        S.cap(P('Every distinct element passes through ' + I('h') + ' and becomes a hash value: one point on the line.'));
      },
      function () {
        off(c1, 0); off(c2, 0); dups.forEach(function (q) { off(q, 0); }); pts[tg].classList.add('is-in'); if (!S.instant) ping(pts[tg]);
        S.cap(P('Duplicates map to the very same value, so they add nothing new.'));
      },
      function () {
        off(c1, 1); off(c2, 1); dups.forEach(function (q) { off(q, 1); }); pts[tg].classList.remove('is-in'); off(msz, 0);
        S.cap(P('Uniform hashing spreads the distinct points across a known range of size ' + I('M') + '.'));
      },
      function () {
        off(thr, 0); off(shade, 0); off(pE, 0);
        pts.forEach(function (p, i) { cls(p, 'is-in', us[i] < 0.3); });
        S.cap(P('A threshold ' + I('x') + ' captures an expected fraction ' + I('x') + '/' + I('M') + ' of the ' + I('d') + ' values, so') + mth(F_EXP, true));
      },
      function () {
        thr.classList.add('is-unk'); tl.textContent = 'x = ?'; off(pU, 0); S.snd('drop');
        S.cap(P('But we cannot choose ' + I('x') + ' using an unknown ' + I('d') + '. The ideal ' + I('x') + ' \u2248 ' + I('t') + I('M') + '/' + I('d') + ' needs the very number we are after.'));
      },
      function () {
        off(thr, 1); off(shade, 1); off(pE, 1); off(pU, 1); off(pT, 0);
        pts.forEach(function (p, i) { cls(p, 'is-in', 0); cls(p, 'is-keep', keepIdx.indexOf(i) >= 0); });
        S.snd('keep');
        S.cap(P('So fix a memory budget ' + I('t') + ' instead, and retain the ' + I('t') + ' smallest distinct hash values.'));
      },
      function () {
        off(vml, 0); S.snd('land');
        S.cap(P('The largest retained value ' + I('v') + ' is the observed threshold: about ' + I('t') + ' hash values lie to its left.'));
      },
      function () {
        cards(1, 0, 0); S.snd('ok');
        S.cap(P('Invert the relationship ' + mth(row(mi('v'), APX, TM_D)) + ' to get the estimator.'));
      },
      function () {
        cards(0, 1, 0);
        S.gate('s8', 'Answer the question to continue.');
        S.cap(P('One last check.'));
      },
      function () {
        cards(0, 0, 1); S.snd('ok');
        S.cap(P('Act II complete.', 1));
      }
    ];
  }

  const SCENES = [
    { title: 'A DIFFERENT WAY TO LOOK', n: 5, build: sc1, desc: 'An element passes through a box labelled h and lands as a point on a number line.' },
    { title: 'ONE POINT PER DIFFERENT ELEMENT', n: 3, build: sc2, desc: 'A stream of eight arrivals a, b, a, c, d, b, e, c produces five points on the hash line.' },
    { title: 'A RANGE FILLS WITH POINTS', n: 4, build: sc3, desc: 'A hash line of fixed length fills with more points as the number of distinct elements grows.' },
    { title: 'THE THRESHOLD', n: 5, build: sc4, desc: 'A threshold x on the hash line, the points below it, and the realised and expected counts as functions of x.' },
    { title: 'THE QUESTION WE CANNOT ASK', n: 4, build: sc5, desc: 'The ideal threshold depends on the unknown d, so instead a budget of t retention slots is chosen.' },
    { title: 'KEEP ONLY THE LEFTMOST', n: 3, build: sc6, desc: 'Eight hash values arrive one by one while the three smallest distinct values are retained.' },
    { title: 'THE BOUNDARY TELLS A STORY', n: 5, build: sc7, desc: 'With more distinct elements the t-th smallest hash value v moves closer to zero.' },
    { title: 'THE THINNEST SLICE', n: 10, build: sc8, desc: 'The whole argument replayed, ending in the estimator d-tilde equals t M over v.' }
  ];

  /* ========================================================================
     Act session
     ====================================================================== */

  function run(ctx) {
    const root = ctx.root, motion = ctx.motion, audio = ctx.audio;
    root.classList.add('a2');

    const heading = el('h2', 'sr-only');
    const kicker = el('p', 'a2-kicker');
    const viz = el('div', 'a2-viz');
    const svg = svgEl('svg', { 'class': 'a2-svg', role: 'img' });
    const ov = el('div', 'a2-ov');
    const cap = el('div', 'a2-cap');
    const note = el('p', 'a2-note');
    const tools = el('div', 'a2-tools');
    viz.append(svg, ov);
    root.append(heading, kicker, viz, cap, note, tools);

    let S = null, si = 0, bi = 0, beats = [];
    let gated = false, gateKey = null, busy = false, destroyed = false;
    const unlocked = new Set();
    const mems = {};
    let memSi = -1;
    const timers = new Set();
    let sT = new Set(), sO = [];
    let capT = 0, lastW = 0, lastH = 0, rsT = 0;
    const liveOsc = new Set();

    const later = function (fn, ms) {
      const id = setTimeout(function () { timers.delete(id); if (!destroyed) fn(); }, ms);
      timers.add(id); return id;
    };

    /* ---- Sound (off until the visitor turns it on) ---- */
    function beep(f, dur, gain, type, delay) {
      try {
        const ac = audio && audio.context && audio.context();
        if (!ac || !audio.output || !audio.running() || (audio.muted && audio.muted())) return;
        const t = ac.currentTime + (delay || 0);
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type || 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(audio.output);
        o.start(t); o.stop(t + dur + 0.05);
        liveOsc.add(o);
        o.onended = function () { liveOsc.delete(o); o.disconnect(); g.disconnect(); };
      } catch (e) { /* ignore */ }
    }
    const SND = {
      land: function () { beep(660, 0.35, 0.05); },
      repeat: function () { beep(330, 0.2, 0.03, 'triangle'); },
      step: function () { beep(880, 0.1, 0.025); },
      keep: function () { beep(523, 0.3, 0.045); beep(784, 0.3, 0.04, 'sine', 0.08); },
      drop: function () { beep(196, 0.25, 0.04, 'triangle'); },
      bad: function () { beep(130, 0.25, 0.05, 'triangle'); },
      ok: function () { [523, 659, 784].forEach(function (f, i) { beep(f, 0.5, 0.045, 'sine', i * 0.09); }); }
    };

    /* ---- Caption / note ---- */
    function setCap(html, s) {
      clearTimeout(capT);
      if (s.final && s.speak) {
        const tmp = document.createElement('div'); tmp.innerHTML = html;
        ctx.announce(tmp.textContent.replace(/\s+/g, ' ').trim());
      }
      if (s.instant || motion.reduced()) { cap.innerHTML = html; cap.classList.remove('is-out'); return; }
      cap.classList.add('is-out');
      capT = setTimeout(function () { cap.innerHTML = html; cap.classList.remove('is-out'); }, cap.innerHTML ? 200 : 0);
    }
    function setNote(txt) { note.textContent = txt || ''; note.classList.toggle('is-on', !!txt); }

    /* ---- Navigation ---- */
    function navUpdate() {
      if (!ctx.nav || destroyed) return;
      const lastBeat = si === SCENES.length - 1 && bi === SCENES[si].n - 1;
      ctx.nav.set({
        back: !busy, forward: !busy && !gated,
        forwardLabel: lastBeat ? 'NEXT ACT \u203A' : 'FORWARD',
        forwardAria: lastBeat ? 'Finish Act II and continue' : 'Forward'
      });
    }

    function makeS(ns, W, H, mem, speak) {
      const m = Math.max(18, Math.min(56, Math.round(W * 0.07)));
      const g = svgEl('g', null, svg);
      const s = { si: ns, W: W, H: H, m: m, x0: m, x1: W - m, g: g, svg: svg, ov: ov, tools: tools, mem: mem,
                  instant: true, final: false, speak: speak };
      s.X = function (u) { return s.x0 + u * (s.x1 - s.x0); };
      s.el = function (tag, attrs, parent, c) { return svgEl(tag, attrs, parent || g, c); };
      s.later = function (fn, ms) {
        const id = setTimeout(function () { sT.delete(id); if (!destroyed) fn(); }, ms);
        sT.add(id); return id;
      };
      s.stop = function (id) { clearTimeout(id); sT.delete(id); };
      s.on = function (t, ty, fn, o) { t.addEventListener(ty, fn, o); sO.push(function () { t.removeEventListener(ty, fn, o); }); };
      s.cap = function (html) { setCap(html, s); };
      s.note = setNote;
      s.snd = function (n) { if (!s.instant && SND[n]) SND[n](); };
      s.done = function (k) { return unlocked.has(k); };
      s.gate = function (key, msg) {
        if (!s.final || unlocked.has(key)) return;
        gated = true; gateKey = key; if (msg) setNote(msg);
      };
      s.unlock = function (key) {
        unlocked.add(key);
        if (gated && gateKey === key) { gated = false; gateKey = null; setNote(''); navUpdate(); }
      };
      s.read = function (bot) { const r = el('div', 'a2-read' + (bot ? ' bot' : '')); ov.appendChild(r); return r; };
      s.pill = function (parent, html, c) { const p = el('span', 'a2-pill' + (c ? ' ' + c : '')); p.innerHTML = html; parent.appendChild(p); return p; };
      s.btn = function (label, fn) {
        const b = el('button', 'a2-btn', label); b.type = 'button';
        b.addEventListener('click', fn); tools.appendChild(b); return b;
      };
      s.group = function () { const gr = el('div', 'a2-grp'); tools.appendChild(gr); return gr; };
      s.slider = function (label, min, max, step, val, fmt, onInput) {
        const w = el('div', 'a2-sl'), l = el('span', 'a2-sl-l', label), inp = el('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
        inp.setAttribute('aria-label', label === 'd' ? 'Number of distinct elements d' : label === 'x' ? 'Threshold x' : label);
        const o = el('span', 'a2-sl-o', fmt(val));
        inp.addEventListener('input', function () { o.textContent = fmt(+inp.value); onInput(+inp.value); });
        w.append(l, inp, o); tools.appendChild(w);
        return { wrap: w, input: inp, out: o, set: function (v) { inp.value = v; o.textContent = fmt(v); } };
      };
      return s;
    }

    function teardown() {
      sT.forEach(clearTimeout); sT.clear();
      sO.splice(0).forEach(function (f) { f(); });
      clearTimeout(capT);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      ov.innerHTML = ''; tools.innerHTML = '';
      svg.classList.remove('is-drag', 'is-dim');
      setNote('');
      gated = false; gateKey = null;
    }

    function build(ns, nb, animate, speak, keepMem) {
      teardown();
      si = ns; bi = nb;
      if (!keepMem || memSi !== ns) { mems[ns] = {}; memSi = ns; }
      const rect = viz.getBoundingClientRect();
      const W = Math.max(220, Math.round(rect.width)), H = Math.max(120, Math.round(rect.height));
      lastW = Math.round(rect.width); lastH = Math.round(rect.height);
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const sc = SCENES[ns];
      kicker.textContent = 'SCENE ' + (ns + 1) + ' \u00B7 ' + sc.title;
      heading.textContent = 'Act II, scene ' + (ns + 1) + ' of ' + SCENES.length + ': ' + sc.title;
      svg.setAttribute('aria-label', sc.desc);
      cap.innerHTML = ''; cap.classList.remove('is-out');
      S = makeS(ns, W, H, mems[ns], speak);
      beats = sc.build(S);
      root.classList.add('is-instant');
      S.instant = true; S.final = false;
      const lastInstant = animate ? bi - 1 : bi;
      for (let i = 0; i <= lastInstant; i++) {
        S.final = (i === bi);
        beats[i](S);
      }
      void root.offsetHeight; getComputedStyle(svg).opacity;
      root.classList.remove('is-instant');
      if (animate) { S.instant = false; S.final = true; beats[bi](S); }
      S.instant = false; S.final = false; S.speak = true;
      navUpdate();
    }

    function go(ns, nb, animate, keep) {
      if (busy || destroyed) return;
      busy = true; navUpdate();
      viz.classList.add('is-out'); cap.classList.add('is-out');
      later(function () {
        build(ns, nb, animate, true, keep);
        viz.classList.remove('is-out');
        busy = false; navUpdate();
      }, motion.reduced() ? 0 : 380);
    }

    function forward() {
      if (busy || gated || destroyed) return;
      if (bi < SCENES[si].n - 1) {
        bi++; S.instant = false; S.final = true; beats[bi](S); S.final = false;
        navUpdate();
      } else if (si < SCENES.length - 1) {
        go(si + 1, 0, true, false);
      } else {
        busy = true; navUpdate();
        ctx.complete().then(function (ok) {
          if (destroyed) return;
          busy = false;
          if (!ok) setNote('The next Act is not available yet.');
          navUpdate();
        });
      }
    }
    function back() {
      if (busy || destroyed) return;
      if (bi > 0) go(si, bi - 1, false, true);
      else if (si > 0) go(si - 1, SCENES[si - 1].n - 1, false, false);
      else {
        busy = true; navUpdate();
        ctx.previous().then(function (ok) { if (destroyed) return; busy = false; navUpdate(); });
      }
    }

    const unbindNav = ctx.nav ? ctx.nav.bind({ back: back, forward: forward }, { keys: true }) : function () {};

    /* ---- Resize: rebuild the current checkpoint instantly ---- */
    let ro = null;
    const onSize = function () {
      if (destroyed || !S) return;
      const w = Math.round(viz.clientWidth), h = Math.round(viz.clientHeight);
      if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
      clearTimeout(rsT);
      rsT = setTimeout(function () {
        if (destroyed || busy) return;
        const g = gated;
        build(si, bi, false, false, true);
        if (!g) navUpdate();
      }, 160);
    };
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(onSize); ro.observe(viz); }
    else { window.addEventListener('resize', onSize); }

    ctx.announce('Act II: finding order in chaos.');
    build(0, 0, true, true, false);

    return function destroy() {
      destroyed = true;
      unbindNav();
      timers.forEach(clearTimeout); timers.clear();
      clearTimeout(rsT);
      teardown();
      if (ro) ro.disconnect(); else window.removeEventListener('resize', onSize);
      liveOsc.forEach(function (o) { try { o.stop(); } catch (e) { /* ignore */ } });
      liveOsc.clear();
      root.classList.remove('a2', 'is-instant');
      while (root.firstChild) root.removeChild(root.firstChild);
    };
  }

  /* ---- Registration ---- */

  let destroyCurrent = null;

  TTS.registerAct('act2', {
    id: 'act2',
    title: 'FINDING ORDER IN CHAOS',
    soundDefault: 'off',
    enter: function (ctx) {
      if (destroyCurrent) destroyCurrent();
      destroyCurrent = run(ctx);
    },
    exit: function () {
      if (destroyCurrent) { destroyCurrent(); destroyCurrent = null; }
    }
  });
})();
