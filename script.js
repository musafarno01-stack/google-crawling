/* Fills the viewer iframe. Same-origin app by default, ?url= for any external embed. */
(function () {
  'use strict';

  var v = document.getElementById('viewer');
  if (!v) return;

  var p = new URLSearchParams(location.search);
  var target = p.get('url');
  var q = p.get('q');

  if (target) {
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    v.src = target;
  } else {
    v.src = q ? '/app?q=' + encodeURIComponent(q) : '/app';
  }

  /* If the frame dies (blocked, offline, 404), say so instead of showing white. */
  var tries = 0;
  v.addEventListener('load', function () { tries = 0; });
  v.addEventListener('error', function () {
    if (tries++ > 1) return;
    v.insertAdjacentHTML('afterend',
      '<p style="margin:0;padding:12px;background:#7f1d1d;color:#fff;font:14px system-ui">' +
      'Viewer could not load. <a style="color:#fff" href="' + v.src + '" target="_blank" rel="noopener">Open directly</a>.</p>');
  });

  /* Keep the address bar in sync when the app changes the search. */
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    if (!e.data || e.data.type !== 'query') return;
    try {
      var u = new URL(location.href);
      e.data.q ? u.searchParams.set('q', e.data.q) : u.searchParams.delete('q');
      history.replaceState(null, '', u);
    } catch (err) {}
  });
})();
