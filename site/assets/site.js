/* GFV website behaviour. No dependencies. Everything degrades gracefully when this file does not run. */
(function () {
  'use strict';
  var root = document.documentElement;
  var base = (document.querySelector('meta[name="gfv-base"]') || {}).content || '';

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch {
      return null;
    }
    return null;
  }

  /* ---- Theme ------------------------------------------------------------------------------------------------ */
  var themeBtn = document.getElementById('theme-toggle');
  function currentTheme() {
    return (
      root.getAttribute('data-theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark')
    );
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      store('gfv-theme', next);
    });
  }

  /* ---- Mobile menus ----------------------------------------------------------------------------------------- */
  function toggle(btnId, targetSelector) {
    var btn = document.getElementById(btnId);
    var target = document.querySelector(targetSelector);
    if (!btn || !target) return;
    btn.addEventListener('click', function () {
      var open = target.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  }
  toggle('menu-toggle', '.nav-links');
  toggle('docs-toggle', '.docs-nav');

  /* ---- Copy buttons ----------------------------------------------------------------------------------------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand('copy')) resolve();
        else reject();
      } catch (e) {
        reject(e);
      }
      document.body.removeChild(ta);
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-copy], .codeblock .copy-btn');
    if (!btn) return;
    var text = btn.getAttribute('data-copy');
    if (text === null) {
      var code = btn.parentElement.querySelector('pre code');
      text = code ? code.textContent : '';
    }
    copyText(text.replace(/\n$/, '')).then(
      function () {
        var label = btn.querySelector('.label');
        var old = label ? label.textContent : '';
        btn.classList.add('done');
        if (label) label.textContent = 'Copied';
        setTimeout(function () {
          btn.classList.remove('done');
          if (label) label.textContent = old;
        }, 1600);
      },
      function () {},
    );
  });

  /* ---- Table of contents highlight -------------------------------------------------------------------------- */
  var tocLinks = [].slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) {
      map[a.getAttribute('href').slice(1)] = a;
    });
    var heads = Object.keys(map)
      .map(function (id) {
        return document.getElementById(id);
      })
      .filter(Boolean);
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            tocLinks.forEach(function (a) {
              a.classList.remove('active');
            });
            var a = map[en.target.id];
            if (a) a.classList.add('active');
          }
        });
      },
      { rootMargin: '-90px 0px -70% 0px', threshold: 0 },
    );
    heads.forEach(function (h) {
      io.observe(h);
    });
  }

  /* ---- Reveal on scroll ------------------------------------------------------------------------------------- */
  root.classList.add('js');
  var reveals = [].slice.call(document.querySelectorAll('.reveal'));
  if (reveals.length) {
    if ('IntersectionObserver' in window) {
      var rio = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              en.target.classList.add('in');
              rio.unobserve(en.target);
            }
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
      );
      reveals.forEach(function (el) {
        rio.observe(el);
      });
    } else {
      reveals.forEach(function (el) {
        el.classList.add('in');
      });
    }
  }

  /* ---- Search ----------------------------------------------------------------------------------------------- */
  var dialog = document.getElementById('search-dialog');
  var input = document.getElementById('search-input');
  var list = document.getElementById('search-results');
  var openers = [].slice.call(document.querySelectorAll('[data-search-open]'));
  var index = null;
  var loading = null;
  var selected = 0;

  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch(base + '/search-index.json')
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          index = data;
          return data;
        })
        .catch(function () {
          index = [];
          return index;
        });
    }
    return loading;
  }
  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function render(q) {
    var query = q.trim().toLowerCase();
    if (!query) {
      list.innerHTML = '<li class="search-empty">Type to search the documentation.</li>';
      return;
    }
    var words = query.split(/\s+/);
    var scored = [];
    (index || []).forEach(function (e) {
      var hay = (e.h + ' ' + e.p + ' ' + e.x).toLowerCase();
      var score = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (hay.indexOf(w) === -1) return;
        if (e.h.toLowerCase().indexOf(w) !== -1) score += 6;
        if (e.p.toLowerCase().indexOf(w) !== -1) score += 3;
        score += 1;
      }
      scored.push({ e: e, s: score });
    });
    scored.sort(function (a, b) {
      return b.s - a.s;
    });
    scored = scored.slice(0, 12);
    if (!scored.length) {
      list.innerHTML = '<li class="search-empty">No results for "' + esc(q) + '".</li>';
      return;
    }
    selected = 0;
    list.innerHTML = scored
      .map(function (r, i) {
        return (
          '<li><a href="' +
          base +
          r.e.u +
          '"' +
          (i === 0 ? ' class="sel"' : '') +
          '>' +
          esc(r.e.h) +
          '<small>' +
          esc(r.e.p) +
          '</small></a></li>'
        );
      })
      .join('');
  }
  function openSearch() {
    if (!dialog || typeof dialog.showModal !== 'function') return;
    dialog.showModal();
    input.value = '';
    list.innerHTML = '<li class="search-empty">Loading…</li>';
    load().then(function () {
      render(input.value);
    });
    input.focus();
  }
  if (dialog && input && list) {
    openers.forEach(function (b) {
      b.addEventListener('click', openSearch);
    });
    input.addEventListener('input', function () {
      load().then(function () {
        render(input.value);
      });
    });
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });
    input.addEventListener('keydown', function (e) {
      var items = [].slice.call(list.querySelectorAll('a'));
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items[selected]) items[selected].classList.remove('sel');
        selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[selected].classList.add('sel');
        items[selected].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selected]) window.location.href = items[selected].getAttribute('href');
      }
    });
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        openSearch();
      }
    });
  }
})();
