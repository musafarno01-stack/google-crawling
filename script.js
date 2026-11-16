/* Fills the viewer. Server already injected the right URL; this only adjusts it. */
(function () {
  'use strict';

  var v = document.getElementById('viewer');
  if (!v) return;

  var p = new URLSearchParams(location.search);
  var target = p.get('url');
  var q = p.get('q');
  var desired;

  if (target) {
    desired = /^https?:\/\//i.test(target) ? target : 'https://' + target;
  } else {
    desired = q ? '/app?q=' + encodeURIComponent(q) : '/app';
  }

  /* Avoid a needless second navigation if the worker already set this. */
  if (v.getAttribute('src') !== desired) v.src = desired;

  var tried = false;
  v.addEventListener('error', function () {
    if (tried) return;
    tried = true;
    var note = document.createElement('p');
    note.className = 'frameerror';
    note.innerHTML = 'Viewer could not load. <a href="' + v.src + '" target="_blank" rel="noopener">Open it directly</a>.';
    v.insertAdjacentElement('afterend', note);
  });

  /* Keep the address bar in step with searches made inside the widget. */
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    if (!e.data || e.data.type !== 'query') return;
    try {
      var u = new URL(location.href);
      if (e.data.q) u.searchParams.set('q', e.data.q);
      else u.searchParams.delete('q');
      history.replaceState(null, '', u);
    } catch (err) {}
  });
})();
