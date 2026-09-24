/*
 * Classic (non-module) script that runs before the game modules. It reports boot
 * failures on the loading screen instead of leaving a silent black page, e.g. when the
 * page is opened straight from disk (file://) where browsers block ES modules.
 */
(function () {
  'use strict';

  function show(message) {
    var box = document.getElementById('boot-error');
    var status = document.getElementById('boot-status');
    if (!box) return;
    box.hidden = false;
    box.textContent = message;
    if (status) status.textContent = 'BOOT FAILURE';
  }

  window.__neonBootError = show;

  window.addEventListener('error', function (e) {
    if (window.__NEON_READY__) return;
    var msg = (e && (e.message || (e.error && e.error.message))) || 'Unknown error';
    show('Something went wrong while starting the game:\n' + msg);
  });

  window.addEventListener('unhandledrejection', function (e) {
    if (window.__NEON_READY__) return;
    var r = e && e.reason;
    show('Something went wrong while starting the game:\n' + ((r && r.message) || r || 'Unknown error'));
  });

  if (location.protocol === 'file:') {
    setTimeout(function () {
      if (window.__NEON_BOOTED__) return;
      show(
        'NEON SURGE uses ES modules, which browsers block on file:// pages.\n\n' +
          'Serve the folder over HTTP instead, for example:\n' +
          '  npx serve .        or        python -m http.server 8080\n' +
          'then open http://localhost:8080 (or upload the zip to itch.io).'
      );
    }, 1500);
  }
})();
