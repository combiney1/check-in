// input: a target element, duration in ms, onProgress(p 0..1) and onComplete callbacks
// output: CK.hold.attach() — press-and-hold gesture that fills forward and drains back on release
// pos: UI interaction layer for the kiosk check-in gesture
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  const DRAIN_RATE = 2.5;

  // Attach a hold gesture; returns {reset, destroy}.
  function attach(target, { durationMs, onProgress, onComplete, onStart }) {
    let progress = 0;
    let pressing = false;
    let done = false;
    let lastTs = 0;
    let rafId = 0;
    let pointerId = null;

    function frame(ts) {
      const dt = lastTs ? ts - lastTs : 0;
      lastTs = ts;
      const delta = dt / durationMs;
      progress = pressing ? Math.min(1, progress + delta) : Math.max(0, progress - delta * DRAIN_RATE);
      onProgress(progress);
      if (progress >= 1 && pressing && !done) {
        done = true;
        pressing = false;
        rafId = 0;
        onComplete();
        return;
      }
      if (pressing || progress > 0) rafId = root.requestAnimationFrame(frame);
      else { rafId = 0; lastTs = 0; }
    }

    function ensureLoop() {
      if (!rafId) { lastTs = 0; rafId = root.requestAnimationFrame(frame); }
    }

    function start(event) {
      if (done || pressing) return;
      event.preventDefault();
      pressing = true;
      pointerId = event.pointerId;
      try { target.setPointerCapture(pointerId); } catch (_err) { /* older Safari */ }
      if (onStart) onStart();
      ensureLoop();
    }

    function stop(event) {
      if (!pressing || (event && event.pointerId !== pointerId)) return;
      pressing = false;
      ensureLoop();
    }

    const block = (event) => event.preventDefault();
    target.addEventListener('pointerdown', start);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', stop);
    target.addEventListener('lostpointercapture', stop);
    target.addEventListener('contextmenu', block);
    target.addEventListener('touchstart', block, { passive: false });

    function reset() {
      if (rafId) root.cancelAnimationFrame(rafId);
      rafId = 0; progress = 0; pressing = false; done = false; lastTs = 0;
      onProgress(0);
    }

    function destroy() {
      reset();
      target.removeEventListener('pointerdown', start);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', stop);
      target.removeEventListener('lostpointercapture', stop);
      target.removeEventListener('contextmenu', block);
      target.removeEventListener('touchstart', block);
    }

    return { reset, destroy };
  }

  root.CK = Object.assign(root.CK || {}, { hold: { attach } });
})(self);
