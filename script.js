/* ============================================================================
   THE THINNEST SLICE — main application controller

   Act module interface (each Acts/actN.js must call registerAct):

     window.TheThinnestSlice.registerAct('actN', {
       id: 'actN',
       enter(ctx) { ... },   // build + run the Act inside ctx.root
       exit()     { ... }    // remove ALL listeners/timers/rAF loops/DOM
     });

   ctx = {
     root:     HTMLElement — the Act's own container (owned by the controller)
     announce: (message) => void — polite screen-reader announcement
     motion:   { reduced(): boolean, subscribe(cb): unsubscribeFn }
     audio:    shared sound engine (see below)
     complete: () => void — the Act is finished; the controller enters the next
   }

   Shared audio engine (ctx.audio):
     context():      AudioContext, or null if the browser has no Web Audio
     output:         GainNode (master bus) — Acts connect their own nodes here
     running():      true once the browser has allowed audio (needs a gesture)
     revealToggle(): fades in the small ENABLE SOUND / SOUND ON / SOUND OFF
                     button (bottom right)
   Acts own every node they create and must disconnect them on exit.

   Mobile notes:
     - Audio is re-resumed on any later gesture (iOS "interrupted" state),
       and iOS is switched to the "playback" audio session so sound is not
       silenced by the ringer switch.
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
  const stage = document.getElementById('stage');
  const live = document.getElementById('live');
  const cover = document.getElementById('cover');
  const app = document.getElementById('app');

  let current = null;       // { index, mod, section, completed }
  let transitioning = false;
  let announceTimer = 0;

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

  /* ---- Shared audio engine ---------------------------------------------- */

  const audio = (function () {
    const AC = window.AudioContext || window.webkitAudioContext;
    const MASTER_LEVEL = 0.85;
    const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let ac = null, master = null, comp = null;
    let muted = false, suspendedByHidden = false;
    let btn = null;
    let keepAlive = null, keepAliveWanted = false;

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

    if (AC) {
      try {
        ac = new AC();
        comp = ac.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.knee.value = 24;
        comp.ratio.value = 4;
        comp.attack.value = 0.01;
        comp.release.value = 0.3;
        master = ac.createGain();
        master.gain.value = MASTER_LEVEL;
        master.connect(comp);
        comp.connect(ac.destination);
      } catch (err) {
        ac = null; master = null;
        console.warn('[Audio] Web Audio unavailable:', err);
      }
    }

    function running() { return !!ac && ac.state === 'running'; }

    function label() {
      if (!running()) return ['ENABLE SOUND', 'Enable sound'];
      return muted
        ? ['SOUND OFF', 'Sound is off. Activate to turn sound on.']
        : ['SOUND ON', 'Sound is on. Activate to mute.'];
    }

    function updateButton() {
      if (!btn) return;
      const l = label();
      btn.textContent = l[0];
      btn.setAttribute('aria-label', l[1]);
    }

    function applyMute() {
      if (!master) return;
      const t = ac.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, t, 0.06);
    }

    /* Unlock: browsers only allow audio after a user gesture. The listener
       stays attached so audio can be recovered after a mobile interruption
       (phone call, app switch, lock screen). */
    const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'];
    function onGesture(e) {
      if (!ac) return;
      if (btn && e && btn.contains(e.target)) return;   // the toggle handles itself
      startKeepAlive();
      if (ac.state !== 'running' && !document.hidden) {
        ac.resume().then(updateButton).catch(function () {});
      }
    }

    if (ac) {
      GESTURES.forEach(function (t) { window.addEventListener(t, onGesture, { capture: true, passive: true }); });
      ac.onstatechange = updateButton;
      ac.resume().then(updateButton).catch(function () {});

      document.addEventListener('visibilitychange', function () {
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
    }

    function ensureButton() {
      if (btn || !ac) return;
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sound-toggle';
      btn.addEventListener('click', function () {
        startKeepAlive();
        if (!running()) { ac.resume().then(updateButton).catch(function () {}); return; }
        muted = !muted;
        applyMute();
        updateButton();
      });
      app.appendChild(btn);
      updateButton();
    }

    function revealToggle() {
      if (!ac) return;
      ensureButton();
      requestAnimationFrame(function () { if (btn) btn.classList.add('is-on'); });
    }

    return {
      context: function () { return ac; },
      output: master,
      running: running,
      revealToggle: revealToggle
    };
  })();

  /* ---- Act registry and loading ----------------------------------------- */

  function registerAct(id, mod) {
    registry.set(id, mod);
  }

  function loadActScript(index) {
    return new Promise(function (resolve) {
      if (index < 0 || index >= ACT_SOURCES.length) return resolve(false);
      if (registry.has(actId(index))) return resolve(true);
      const s = document.createElement('script');
      s.src = ACT_SOURCES[index];
      s.async = true;
      s.onload = function () { resolve(registry.has(actId(index))); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
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

    mod.enter({
      root: section,
      announce: announce,
      motion: motion,
      audio: audio,
      complete: function () { handleComplete(index); }
    });
    return true;
  }

  function leaveCurrent() {
    if (!current) return;
    try { current.mod.exit(); } catch (err) { console.error('[Controller] Act exit failed:', err); }
    if (current.section.parentNode) current.section.parentNode.removeChild(current.section);
    current = null;
  }

  function handleComplete(index) {
    if (!current || current.index !== index || current.completed || transitioning) return;
    current.completed = true;

    const next = index + 1;
    if (next >= ACT_SOURCES.length) return;

    loadActScript(next).then(function (ok) {
      if (!ok) {
        console.info('[Controller] Act ' + (next + 1) + ' is not available yet; remaining on Act ' + (index + 1) + '.');
        return null;
      }
      return transitionTo(next);
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
