/* Path-based viewer: /host/path?query -> https://host/path?query */
(function () {
  'use strict';

  var v = document.getElementById('viewer');
  if (!v) return;

  var path = location.pathname.replace(/^\/+/, '');
  var target = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(path.split('/')[0] || '')
    ? 'https://' + path + location.search
    : null;

  if (target && v.getAttribute('src') !== target) v.src = target;

  var tried = false;
  v.addEventListener('error', function () {
    if (tried) return;
    tried = true;
    var n = document.createElement('p');
    n.className = 'note';
    n.innerHTML = 'This site refuses to be framed. <a href="' + (target || location.href) + '" target="_blank" rel="noopener">Open it directly ↗</a>';
    v.insertAdjacentElement('afterend', n);
  });
})();
