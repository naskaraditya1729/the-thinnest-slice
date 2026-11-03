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

  /* ---- Shared audio engine ---------------------------------------------- */

  const audio = (function () {
    const AC = window.AudioContext || window.webkitAudioContext;
    const MASTER_LEVEL = 0.85;
    let ac = null, master = null, comp = null;
    let muted = false, suspendedByHidden = false;
    let btn = null;

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

    /* Unlock: browsers only allow audio after a user gesture. */
    const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'];
    function onGesture(e) {
      if (!ac) return;
      if (btn && e && btn.contains(e.target)) return;   // the toggle handles itself
      ac.resume().then(function () {
        if (ac.state === 'running') unbind();
        updateButton();
      }).catch(function () {});
    }
    function unbind() {
      GESTURES.forEach(function (t) { window.removeEventListener(t, onGesture, true); });
    }

    if (ac) {
      GESTURES.forEach(function (t) { window.addEventListener(t, onGesture, true); });
      ac.onstatechange = updateButton;
      ac.resume().then(function () { if (ac.state === 'running') unbind(); updateButton(); }).catch(function () {});

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          if (ac.state === 'running') { suspendedByHidden = true; ac.suspend().catch(function () {}); }
        } else if (suspendedByHidden) {
          suspendedByHidden = false;
          ac.resume().catch(function () {});
        }
      });
    }

    function ensureButton() {
      if (btn || !ac) return;
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sound-toggle';
      btn.addEventListener('click', function () {
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
