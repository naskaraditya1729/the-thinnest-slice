/* ============================================================================
   THE THINNEST SLICE — main application controller

   Act module interface (each Acts/actN.js must call registerAct):

     window.TheThinnestSlice.registerAct('actN', {
       id: 'actN',
       soundDefault: 'off',   // optional: the Act starts muted (the visitor opts in)
       enter(ctx) { ... },    // build + run the Act inside ctx.root
       exit()     { ... }     // remove ALL listeners/timers/rAF loops/DOM/audio
     });

   A script that registers an id other than the one being loaded is ignored.

   ctx = {
     root:     HTMLElement — the Act's own container (owned by the controller)
     announce: (message) => void — polite screen-reader announcement
     motion:   { reduced(): boolean, subscribe(cb): unsubscribeFn }
     audio:    shared sound engine (see below)
     nav:      Back / Forward cluster (see below)
     complete: () => Promise<boolean> — go to the next Act. Resolves true if a
               transition happened, false if there is no next Act.
     previous: () => Promise<boolean> — go back to the previous Act (false on Act I).
     hasPrevious: boolean
     nextReady: () => Promise<boolean> — resolves true when the next Act exists
               and is loaded (use it to enable a Forward button).
     preloadNext: () => void — optional early fetch of the next Act's script
   }

   Shared audio engine (ctx.audio). The AudioContext is created lazily, on the
   visitor's first click / tap / key press (browsers refuse to start audio
   before that), so context() is null until then.
     supported:      false if the browser has no Web Audio
     context():      AudioContext, or null if not created yet / unsupported
     onReady(cb):    cb() once the context exists (immediately if it already
                     does); returns an unsubscribe function
     output:         GainNode (master bus) — Acts connect their own nodes here
     running():      true once the context is running
     muted():        true while the visitor has sound switched off
     setMuted(v):    switch sound off / on (smooth)
     onChange(cb):   cb(muted) on every change; returns an unsubscribe function
     latency():      output latency in seconds (capped)
     revealToggle(): fades in the bottom-right controls (sound, and Back /
                     Forward if an Act has bound them)

   Navigation (ctx.nav):
     bind({ back, forward }, { keys: true, reveal: true }) -> unbind
         Shows the Back / Forward buttons and routes them to the two handlers.
         keys:false  = do not bind the Left / Right arrow keys (the Act uses
                       them itself). With keys on, arrows are ignored while an
                       input, slider or other control outside the cluster has
                       focus.
         reveal:false = keep the buttons invisible until revealToggle().
     set({ back: bool, forward: bool, forwardLabel: string, forwardAria: string })
         Enabled state and label of the buttons.

   Mobile notes:
     - Audio is re-resumed on any later gesture (iOS "interrupted" state), and
       iOS is switched to the "playback" audio session.
     - The on-screen keyboard height is published as the CSS variable --kb on
       #app so Acts can keep inputs visible.
   ========================================================================== */

(function () {
  'use strict';

  const ACT_SOURCES = [
    'Acts/act1.js', 'Acts/act2.js', 'Acts/act3.js',
    'Acts/act4.js', 'Acts/act5.js', 'Acts/act6.js'
  ];

  const registry = new Map();
  const expecting = new Set();     // act ids whose scripts are loading right now
  const missing = new Set();       // indices whose script failed or registered nothing
  const stage = document.getElementById('stage');
  const live = document.getElementById('live');
  const cover = document.getElementById('cover');
  const app = document.getElementById('app');

  let current = null;       // { index, mod, section, completed }
  let transitioning = false;
  let announceTimer = 0;
  let chromeShown = false;

  /* ---- Shared utilities ------------------------------------------------- */

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const motion = {
    reduced() { return !!(mq && mq.matches); },
    subscribe(cb) {
      if (!mq) return function () {};
      const handler = function (e) { cb(e.matches); };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
      return function () {
        if (mq.removeEventListener) mq.removeEventListener('change', handler);
        else if (mq.removeListener) mq.removeListener(handler);
      };
    }
  };

  function announce(message) {
    clearTimeout(announceTimer);
    live.textContent = '';
    announceTimer = setTimeout(function () { live.textContent = message; }, 80);
  }

  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const actId = function (index) { return 'act' + (index + 1); };

  /* ---- Viewport / on-screen keyboard ------------------------------------ */

  (function bindViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    function sync() {
      raf = 0;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      app.style.setProperty('--kb', (kb > 80 ? kb : 0) + 'px');
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(sync); }
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('orientationchange', schedule);
    sync();
  })();

  /* ---- Controls cluster: [ < ] [ > ] [ Sound ] --------------------------- */

  const controls = document.createElement('div');
  controls.id = 'controls';
  controls.className = 'controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Navigation and sound');

  function makeCtl(text, aria, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctl ' + (extra || '');
    b.textContent = text;
    b.setAttribute('aria-label', aria);
    return b;
  }
  const GLYPH_BACK = '\u2039';   // ‹
  const GLYPH_FWD = '\u203A';    // ›
  const btnBack = makeCtl(GLYPH_BACK, 'Back', 'ctl-nav');
  const btnFwd = makeCtl(GLYPH_FWD, 'Forward', 'ctl-nav');
  const soundBtn = makeCtl('ENABLE SOUND', 'Enable sound', 'sound-toggle');
  [btnBack, btnFwd].forEach(function (b) {
    b.style.fontSize = '1.4rem';
    b.style.letterSpacing = '0';
    b.style.textIndent = '0';
    b.style.minWidth = '3rem';
    b.style.padding = '0 0.5rem';
  });
  btnBack.hidden = true;
  btnFwd.hidden = true;
  btnBack.disabled = true;
  btnFwd.disabled = true;
  controls.append(btnBack, btnFwd, soundBtn);
  app.appendChild(controls);

  /* Fades in the sound button and, if an Act has bound them, the arrows. */
  function revealChrome() {
    chromeShown = true;
    requestAnimationFrame(function () {
      if (!soundBtn.hidden) soundBtn.classList.add('is-on');
      if (!btnBack.hidden) btnBack.classList.add('is-on');
      if (!btnFwd.hidden) btnFwd.classList.add('is-on');
    });
  }

  /* ---- Navigation API ---------------------------------------------------- */

  const nav = (function () {
    let handlers = null;
    let keysOn = true;

    btnBack.addEventListener('click', function () { if (handlers && handlers.back && !btnBack.disabled) handlers.back(); });
    btnFwd.addEventListener('click', function () { if (handlers && handlers.forward && !btnFwd.disabled) handlers.forward(); });

    document.addEventListener('keydown', function (e) {
      if (!handlers || !keysOn || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t && t !== document.body && t !== document.documentElement && !controls.contains(t) && t.closest &&
          t.closest('input, select, textarea, button, a, [contenteditable], [role="slider"], [tabindex]')) return;
      const left = e.key === 'ArrowLeft';
      const btn = left ? btnBack : btnFwd;
      if (btn.disabled) return;
      e.preventDefault();
      const fn = left ? handlers.back : handlers.forward;
      if (fn) fn();
    });

    function bind(h, opts) {
      handlers = h;
      keysOn = !(opts && opts.keys === false);
      btnBack.hidden = false;
      btnFwd.hidden = false;
      controls.classList.add('is-nav');
      if (!(opts && opts.reveal === false) || chromeShown) revealChrome();
      return function unbind() { if (handlers === h) reset(); };
    }

    function set(o) {
      if (!o) return;
      if ('back' in o) btnBack.disabled = !o.back;
      if ('forward' in o) btnFwd.disabled = !o.forward;
      if (o.forwardLabel) {
        const plain = o.forwardLabel === 'FORWARD';
        btnFwd.textContent = plain ? GLYPH_FWD : o.forwardLabel;
        btnFwd.style.fontSize = plain ? '1.4rem' : '';
        btnFwd.style.letterSpacing = plain ? '0' : '';
        btnFwd.style.textIndent = plain ? '0' : '';
      }
      if (o.forwardAria) btnFwd.setAttribute('aria-label', o.forwardAria);
    }

    function reset() {
      handlers = null;
      keysOn = true;
      btnBack.hidden = true;
      btnFwd.hidden = true;
      btnBack.classList.remove('is-on');
      btnFwd.classList.remove('is-on');
      btnBack.disabled = true;
      btnFwd.disabled = true;
      btnFwd.textContent = GLYPH_FWD;
      btnFwd.style.fontSize = '1.4rem';
      btnFwd.style.letterSpacing = '0';
      btnFwd.style.textIndent = '0';
      btnFwd.setAttribute('aria-label', 'Forward');
      controls.classList.remove('is-nav');
    }

    return { bind: bind, set: set, reset: reset };
  })();

  /* ---- Shared audio engine ---------------------------------------------- */

  const audio = (function () {
    const AC = window.AudioContext || window.webkitAudioContext;
    const supported = !!AC;
    const MASTER_LEVEL = 0.85;
    const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let ac = null, master = null, comp = null, failed = false;
    let muted = false, suspendedByHidden = false;
    let keepAlive = null, keepAliveWanted = false;
    const listeners = new Set();
    const readyCbs = new Set();

    /* iOS: route Web Audio through the "playback" session so the ringer
       switch does not silence it. */
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    }

    function silentWavUrl() {
      const sr = 8000, n = 2000;
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      const str = function (o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
      v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
      return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }

    /* Older iOS (no navigator.audioSession): a silent looping media element
       moves the page into the playback audio session. */
    function startKeepAlive() {
      if (!IOS || navigator.audioSession) return;
      try {
        if (!keepAlive) {
          keepAlive = new Audio(silentWavUrl());
          keepAlive.loop = true;
          keepAlive.preload = 'auto';
          keepAlive.setAttribute('playsinline', '');
        }
        keepAliveWanted = true;
        const p = keepAlive.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* ignore */ }
    }

    if (!supported) soundBtn.hidden = true;

    function running() { return !!ac && ac.state === 'running'; }

    function latency() {
      if (!ac) return 0;
      const l = (ac.baseLatency || 0) + (ac.outputLatency || 0);
      return Math.max(0, Math.min(0.12, l));
    }

    /* iOS: a one-sample silent buffer played inside the gesture fully wakes
       the audio hardware. */
    let primed = false;
    function prime() {
      if (primed || !ac) return;
      try {
        const src = ac.createBufferSource();
        src.buffer = ac.createBuffer(1, 1, 22050);
        src.connect(ac.destination);
        src.start(0);
        primed = true;
      } catch (e) { /* ignore */ }
    }

    function label() {
      if (muted) return ['SOUND OFF', 'Sound is off. Activate to turn sound on.'];
      if (!running()) return ['ENABLE SOUND', 'Enable sound'];
      return ['SOUND ON', 'Sound is on. Activate to turn sound off.'];
    }

    function updateButton() {
      const l = label();
      soundBtn.textContent = l[0];
      soundBtn.setAttribute('aria-label', l[1]);
    }

    function applyMute() {
      if (!master) return;
      const t = ac.currentTime;
      const cur = master.gain.value;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(cur, t);
      master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, t, 0.06);
    }

    function setMuted(v) {
      v = !!v;
      if (v === muted) { updateButton(); return; }
      muted = v;
      applyMute();
      updateButton();
      listeners.forEach(function (cb) { try { cb(muted); } catch (e) { /* ignore */ } });
    }

    /* Creates the AudioContext. Only ever called from a user gesture, so the
       browser allows it to start (no autoplay warning). */
    function ensure() {
      if (ac || !supported || failed) return ac;
      try {
        // "playback" favours uninterrupted output over minimum latency: the
        // sound here is ambient and scheduled ahead of time.
        try { ac = new AC({ latencyHint: 'playback' }); } catch (e) { ac = new AC(); }
        comp = ac.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.knee.value = 24;
        comp.ratio.value = 4;
        comp.attack.value = 0.01;
        comp.release.value = 0.3;
        master = ac.createGain();
        master.gain.value = muted ? 0 : MASTER_LEVEL;
        master.connect(comp);
        comp.connect(ac.destination);
        ac.onstatechange = updateButton;
      } catch (err) {
        ac = null; master = null; failed = true;
        soundBtn.hidden = true;
        console.warn('[Audio] Web Audio unavailable:', err);
        return null;
      }
      updateButton();
      readyCbs.forEach(function (cb) { try { cb(); } catch (e) { console.error('[Audio] ready callback failed:', e); } });
      readyCbs.clear();
      return ac;
    }

    /* Unlock: browsers only allow audio after a user gesture. The listener
       stays attached so audio can be recovered after a mobile interruption
       (phone call, app switch, lock screen). */
    const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'];
    function onGesture(e) {
      if (!supported) return;
      if (e && soundBtn.contains(e.target)) return;   // the toggle handles itself
      ensure();
      if (!ac) return;
      startKeepAlive();
      if (ac.state !== 'running' && !document.hidden) {
        ac.resume().then(function () { prime(); updateButton(); }).catch(function () {});
      }
    }

    if (supported) {
      GESTURES.forEach(function (t) { window.addEventListener(t, onGesture, { capture: true, passive: true }); });

      document.addEventListener('visibilitychange', function () {
        if (!ac) return;
        if (document.hidden) {
          if (keepAlive) { try { keepAlive.pause(); } catch (e) { /* ignore */ } }
          if (ac.state === 'running') { suspendedByHidden = true; ac.suspend().catch(function () {}); }
        } else {
          if (keepAlive && keepAliveWanted) { const p = keepAlive.play(); if (p && p.catch) p.catch(function () {}); }
          if (suspendedByHidden) {
            suspendedByHidden = false;
            ac.resume().catch(function () {});
          } else if (ac.state !== 'running') {
            ac.resume().catch(function () {});
          }
        }
      });

      soundBtn.addEventListener('click', function () {
        ensure();
        if (!ac) return;
        startKeepAlive();
        const wake = function () { ac.resume().then(function () { prime(); updateButton(); }).catch(function () {}); };
        if (muted) {                                  // turn sound on (explicit activation)
          setMuted(false);
          if (!running()) wake();
          return;
        }
        if (!running()) { wake(); return; }
        setMuted(true);
      });
      updateButton();
    }

    return {
      supported: supported,
      context: function () { return ac; },
      get output() { return master; },
      onReady: function (cb) {
        if (ac) { cb(); return function () {}; }
        readyCbs.add(cb);
        return function () { readyCbs.delete(cb); };
      },
      running: running,
      muted: function () { return muted; },
      setMuted: setMuted,
      onChange: function (cb) {
        listeners.add(cb);
        return function () { listeners.delete(cb); };
      },
      latency: latency,
      revealToggle: revealChrome
    };
  })();

  /* ---- Act registry and loading ----------------------------------------- */

  function registerAct(id, mod) {
    if (expecting.size && !expecting.has(id)) {
      console.warn('[Controller] Ignored a script that registered "' + id + '" while loading ' +
        Array.from(expecting).join(', ') + '. Check that the file is the right Act.');
      return;
    }
    registry.set(id, mod);
  }

  const loading = new Map();   // index -> Promise; one request per Act, however often asked

  function loadActScript(index) {
    if (index < 0 || index >= ACT_SOURCES.length) return Promise.resolve(false);
    if (registry.has(actId(index))) return Promise.resolve(true);
    if (missing.has(index)) return Promise.resolve(false);
    if (loading.has(index)) return loading.get(index);
    const id = actId(index);
    expecting.add(id);
    const p = new Promise(function (resolve) {
      const s = document.createElement('script');
      s.src = ACT_SOURCES[index];
      s.async = true;
      s.onload = function () { resolve(registry.has(id)); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    }).then(function (ok) {
      expecting.delete(id);
      loading.delete(index);
      if (!ok) missing.add(index);
      return ok;
    });
    loading.set(index, p);
    return p;
  }

  /* ---- Act lifecycle ---------------------------------------------------- */

  async function enterAct(index) {
    const ok = await loadActScript(index);
    if (!ok) return false;

    const mod = registry.get(actId(index));
    const section = document.createElement('section');
    section.className = 'act';
    section.dataset.act = mod.id || actId(index);
    stage.appendChild(section);

    current = { index: index, mod: mod, section: section, completed: false };

    if (mod.soundDefault === 'off') audio.setMuted(true);

    mod.enter({
      root: section,
      announce: announce,
      motion: motion,
      audio: audio,
      nav: { bind: nav.bind, set: nav.set },
      complete: function () { return handleComplete(index); },
      previous: function () { return handleBack(index); },
      hasPrevious: index > 0,
      nextReady: function () { return loadActScript(index + 1); },
      preloadNext: function () { loadActScript(index + 1); }
    });
    return true;
  }

  function leaveCurrent() {
    if (!current) return;
    try { current.mod.exit(); } catch (err) { console.error('[Controller] Act exit failed:', err); }
    nav.reset();
    if (current.section.parentNode) current.section.parentNode.removeChild(current.section);
    current = null;
  }

  function handleComplete(index) {
    if (!current || current.index !== index || current.completed || transitioning) return Promise.resolve(false);
    current.completed = true;

    const next = index + 1;
    if (next >= ACT_SOURCES.length) { current.completed = false; return Promise.resolve(false); }

    return loadActScript(next).then(function (ok) {
      if (!ok) {
        console.info('[Controller] Act ' + (next + 1) + ' is not available yet (Acts/' + actId(next) + '.js is missing or does not register "' + actId(next) + '"); remaining on Act ' + (index + 1) + '.');
        if (current && current.index === index) current.completed = false;
        return false;
      }
      return transitionTo(next).then(function () { return true; });
    });
  }

  function handleBack(index) {
    if (!current || current.index !== index || transitioning || index <= 0) return Promise.resolve(false);
    return loadActScript(index - 1).then(function (ok) {
      if (!ok) return false;
      return transitionTo(index - 1).then(function () { return true; });
    });
  }

  async function transitionTo(index) {
    transitioning = true;
    cover.classList.add('is-on');
    await wait(motion.reduced() ? 0 : 750);
    leaveCurrent();
    await enterAct(index);
    await wait(60);
    cover.classList.remove('is-on');
    transitioning = false;
  }

  /* ---- Public surface and boot ------------------------------------------ */

  window.TheThinnestSlice = {
    registerAct: registerAct,
    motion: motion,
    announce: announce,
    audio: audio
  };

  enterAct(0).then(function (ok) {
    if (!ok) console.error('[Controller] Could not load Acts/act1.js');
  });
})();
