/* Token Radar — the page over window.RADAR: sortable, filterable, with a detail
   view per protocol. No network, no framework: the data ships beside the page. */
(function () {
  'use strict';

  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="8">No radar data found.</td></tr>';
    return;
  }

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- formatting ---------- */
  function money(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- header stats ---------- */
  var stats = [
    ['Protocols', R.board_size + R.live_size + ''],
    ['Watchlist', R.watchlist_size + ''],
    ['Ranked pre-token', R.board_size + ''],
    ['Live tokens', R.live_size + ''],
    ['Snapshot', R.as_of],
  ];
  $('stats').innerHTML = stats.map(function (s) {
    return '<div><dt>' + s[0] + '</dt><dd>' + esc(s[1]) + '</dd></div>';
  }).join('');
  $('market-multiple').textContent = R.market_multiple.toFixed(3) + 'x';
  $('multiples').innerHTML = R.multiples.map(function (m) {
    return '<div class="mult"><b>' + esc(m.category) + '</b><span>' + m.multiple.toFixed(3) + 'x</span> <small>· ' + m.protocols + ' token protocols</small></div>';
  }).join('');

  /* ---------- filter controls ---------- */
  var watchlistSlugs = {};
  var categories = {};
  var chains = {};
  R.rows.forEach(function (r) {
    if (r.category) categories[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  function fillSelect(el, values) {
    Object.keys(values).sort().forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      el.appendChild(o);
    });
  }
  fillSelect($('category'), categories);
  fillSelect($('chain'), chains);

  var state = { tab: 'pre', q: '', category: '', chain: '', watchlist: false, sort: 'rank', dir: 1 };
  var watchlistSet = {};
  R.watchlist.forEach(function (slug) { watchlistSet[slug] = 1; });

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    var params = new URLSearchParams(h);
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist') === '1') state.watchlist = true;
    return params.get('p');
  }
  function writeHash(openSlug) {
    var params = new URLSearchParams();
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (openSlug) params.set('p', openSlug);
    var h = params.toString();
    history.replaceState(null, '', h ? '#' + h : window.location.pathname + window.location.search);
  }

  /* ---------- rendering ---------- */
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.watchlist && !watchlistSet[r.slug]) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function sortRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return dir * (av < bv ? -1 : av > bv ? 1 : 0);
      if (Array.isArray(av)) return dir * (av.length - bv.length);
      return dir * (av - bv);
    });
  }
  function changeCell(n) {
    if (n === null || n === undefined) return '<span>—</span>';
    return '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + pct(n) + '</span>';
  }
  function render() {
    var pre = state.tab === 'pre';
    $('tab-pre').classList.toggle('on', pre);
    $('tab-live').classList.toggle('on', !pre);
    $('tab-pre').setAttribute('aria-selected', pre ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', !pre ? 'true' : 'false');
    $('board').hidden = !pre;
    $('live').hidden = pre;
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('watchlist-only').checked = state.watchlist;
    if (!pre) {
      $('live-rows').innerHTML = R.live.map(function (r, i) {
        return '<tr><td class="num">' + (i + 1) + '</td>' +
          '<td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
          '<td><span class="chip">' + esc(r.category || '—') + '</span></td>' +
          '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td>' +
          '<td class="num">' + changeCell(r.change_7d) + '</td>' +
          '<td class="num">' + money(r.mcap_usd) + '</td></tr>';
      }).join('');
      $('count').textContent = R.live_size + ' protocols whose token already trades, at market values — kept apart from the radar.';
      return;
    }
    var rows = sortRows(visibleRows());
    $('count').textContent = rows.length + ' of ' + R.board_size + ' pre-token protocols' +
      (state.watchlist ? ' on the watchlist' : '') + ' · sorted by ' + state.sort.replace('_', ' ') + '.';
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="chip">' + esc(r.category || '—') + '</span>' +
        (watchlistSet[r.slug] ? '<span class="wl">WATCHLIST</span>' : '') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeCell(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('') || '<tr><td colspan="8">Nothing matches these filters.</td></tr>';
  }

  /* ---------- detail view ---------- */
  var dialog = $('detail');
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return;
    var steps = r.farm_steps.map(function (s) {
      var parts = s.split(' Cost: ');
      var action = parts[0];
      var ct = parts.length > 1 ? 'Cost: ' + parts[1] : '';
      return '<li>' + esc(action) + (ct ? '<span class="ct">' + esc(ct) + '</span>' : '') + '</li>';
    }).join('');
    var eq = moneyFull(r.tvl_usd) + ' × ' + r.base_multiple.toFixed(3) + ' × ' +
      r.growth_multiplier.toFixed(2) + ' × ' + r.maturity_multiplier.toFixed(2) + ' × ' +
      r.breadth_multiplier.toFixed(2) + ' = ' + moneyFull(r.implied_value_usd);
    $('detail-body').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
      esc(r.chains.join(', ')) + ' · ' + (watchlistSet[r.slug] ? 'on the watchlist · ' : '') +
      'tracked since ' + esc(r.listed_at || 'unknown') + '</p>' +
      '<div class="big-label">Implied value</div>' +
      '<div class="big">' + moneyFull(r.implied_value_usd) + '</div>' +
      '<div class="model-box"><span class="eq">' + esc(eq) + '</span><table>' +
      '<tr><td>TVL</td><td>' + moneyFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple</td><td>' + r.base_multiple.toFixed(3) + 'x — ' + esc(r.multiple_source) + '</td></tr>' +
      '<tr><td>7-day growth</td><td>' + pct(r.growth_pct) + ' → ×' + r.growth_multiplier.toFixed(2) + '</td></tr>' +
      '<tr><td>Maturity</td><td>×' + r.maturity_multiplier.toFixed(2) + ' (' + ageText(r.age_days) + ' with no token)</td></tr>' +
      '<tr><td>Breadth</td><td>×' + r.breadth_multiplier.toFixed(2) + ' (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td></tr>' +
      '</table></div>' +
      '<h3>How to farm it</h3><ol>' + steps + '</ol>' +
      '<p class="disclaimer">DefiLlama records no token for this protocol. That is the list\u2019s record, not proof it has none — and the implied value is this radar\u2019s own claim, never a promise. Never pay to claim an airdrop.</p>';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    writeHash(slug);
  }
  dialog.addEventListener('close', function () { writeHash(null); });

  /* ---------- events ---------- */
  $('tab-pre').addEventListener('click', function () { state.tab = 'pre'; writeHash(null); render(); });
  $('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(null); render(); });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; writeHash(null); render(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(null); render(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(null); render(); });
  $('watchlist-only').addEventListener('change', function (e) { state.watchlist = e.target.checked; writeHash(null); render(); });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) { state.dir = -state.dir; } else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      document.querySelectorAll('#board th[data-sort]').forEach(function (h) {
        h.classList.toggle('on', h === th);
        h.classList.toggle('asc', h === th && state.dir === 1);
      });
      render();
    });
  });
  window.addEventListener('hashchange', function () {
    var slug = readHash();
    render();
    if (slug) openDetail(slug);
  });

  var openSlug = readHash();
  render();
  if (openSlug) openDetail(openSlug);
})();
