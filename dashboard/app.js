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
  $('formula').textContent = R.fit.coefficients.map(function (c, i) {
    var name = ['1', 'ln(TVL)', 'ln(1+age)', 'growth', 'chains', 'age unknown'][i];
    var sign = c >= 0 ? '+' : '−';
    return (i === 0 ? '' : ' ' + sign + ' ') + Math.abs(c).toFixed(2) + '·' + name;
  }).join('') + ' + category offset';
  var coefRows = R.fit.coefficients.map(function (c, i) {
    return '<tr><td>' + esc(R.fit.coefficientNames[i]) + '</td><td class="num">' + (c >= 0 ? '+' : '') + c.toFixed(4) + '</td></tr>';
  }).join('');
  var offs = R.fit.categoryOffsets;
  var offText = offs.length
    ? 'Category offsets run from ' + offs[0].offset.toFixed(2) + ' (' + esc(offs[0].category) + ') to ' +
      offs[offs.length - 1].offset.toFixed(2) + ' (' + esc(offs[offs.length - 1].category) + '), shrunk by n/(n+5).'
    : '';
  $('coefs').innerHTML = '<table class="coef"><thead><tr><th>Fitted term</th><th class="num">Coefficient</th></tr></thead><tbody>' +
    coefRows + '</tbody></table><p>' + offText + '</p>';
  var o = R.fit.outOfSample;
  $('validation').innerHTML = 'Fit on <strong>' + R.fit.fitProtocols + ' token protocols</strong>' +
    ' (seven excluded for market cap / TVL over 10×: ' + R.fit.excludedSlugs.map(esc).join(', ') + ').' +
    ' In-sample R² ' + R.fit.r2InSample.toFixed(2) + '.' +
    ' Validated out of sample on a 20% holdout (' + o.testProtocols + ' protocols): R² ' + o.fittedR2.toFixed(2) +
    ' and median absolute log error ' + o.fittedMedianAbsLogError.toFixed(2) +
    ', against the radar-2 median model on the same holdout (R² ' + o.v2R2.toFixed(2) +
    ', median error ' + o.v2MedianAbsLogError.toFixed(2) + ').' +
    ' The fitted 7-day growth weight is small — in this snapshot the median token protocol ' +
    (R.fit.medianGrowthPct >= 0 ? 'gained ' : 'lost ') + Math.abs(R.fit.medianGrowthPct).toFixed(1) + '% of TVL in seven days, so a week\u2019s move carries almost no signal about market cap; the size curve and the category do the work.';

  /* ---------- fitted-vs-actual chart ---------- */
  (function renderFitChart() {
    var pts = R.fit.chart || [];
    var svg = $('fitchart');
    if (!pts.length || !svg) return;
    var W = 560, H = 260, L = 46, Rr = 12, T = 10, B = 30;
    var xs = pts.map(function (p) { return p.fitted; });
    var ys = pts.map(function (p) { return p.actual; });
    var lo = Math.floor(Math.min.apply(null, xs.concat(ys)) - 0.5);
    var hi = Math.ceil(Math.max.apply(null, xs.concat(ys)) + 0.5);
    function X(v) { return L + (v - lo) / (hi - lo) * (W - L - Rr); }
    function Y(v) { return H - B - (v - lo) / (hi - lo) * (H - T - B); }
    var out = '';
    out += '<line x1="' + X(lo) + '" y1="' + Y(lo) + '" x2="' + X(hi) + '" y2="' + Y(hi) + '" class="diag"/>';
    [lo, (lo + hi) / 2, hi].forEach(function (v) {
      out += '<text x="' + X(v) + '" y="' + (H - 24) + '" class="ax">' + v.toFixed(0) + '</text>';
      out += '<text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" class="ax" text-anchor="end">' + v.toFixed(0) + '</text>';
    });
    out += '<text x="' + ((W + L) / 2) + '" y="' + (H - 8) + '" class="ax cap" text-anchor="middle">fitted log market cap</text>';    out += '<text x="14" y="' + ((H + T) / 2) + '" class="ax cap" text-anchor="middle" transform="rotate(-90 14 ' + ((H + T) / 2) + ')">actual log market cap</text>';
    pts.forEach(function (p) {
      out += '<circle cx="' + X(p.fitted).toFixed(1) + '" cy="' + Y(p.actual).toFixed(1) + '" r="3.5" class="dot"/>';
    });
    svg.innerHTML = out;
  })();

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
  function chainText(chains) {
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3) + ' chains';
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
    var topVal = R.rows.length ? R.rows[0].implied_value_usd : 1;
    $('count').textContent = rows.length + ' of ' + R.board_size + ' pre-token protocols' +
      (state.watchlist ? ' on the watchlist' : '') + ' · sorted by ' + state.sort.replace('_', ' ') + '.';
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top3"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="chip">' + esc(r.category || '—') + '</span>' +
        (watchlistSet[r.slug] ? '<span class="wl">WATCHLIST</span>' : '') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeCell(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) +
        '<span class="valbar" style="width:' + Math.max(2, Math.round(r.implied_value_usd / topVal * 100)) + '%"></span></td></tr>';
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
    var coef = R.fit.coefficients;
    var names = ['1', 'ln(TVL)', 'ln(1+age)', 'growth', 'chains', 'age unknown'];
    var f = r.features;
    function signedTerm(c, v) {
      var prod = c * v;
      return (prod >= 0 ? ' + ' : ' − ') + Math.abs(c).toFixed(2) + '·' + Math.abs(v).toFixed(2);
    }
    var eq = 'log(implied) = ' + coef[0].toFixed(2) +
      signedTerm(coef[1], f[1]) + signedTerm(coef[2], f[2]) + signedTerm(coef[3], f[3]) +
      signedTerm(coef[4], f[4]) + (f[5] ? signedTerm(coef[5], f[5]) : '') +
      (r.category_offset >= 0 ? ' + ' : ' − ') + Math.abs(r.category_offset).toFixed(2) +
      ' = ' + r.predicted_log_mcap.toFixed(2);
    $('detail-body').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
      esc(r.chains.length > 1 ? r.chains[0] + ' + ' + (r.chains.length - 1) + ' more chains' : (r.chains[0] || '—')) + ' · ' + (watchlistSet[r.slug] ? 'on the watchlist · ' : '') +
      'tracked since ' + esc(r.listed_at || 'unknown') + '</p>' +
      '<div class="big-label">Implied value</div>' +
      '<div class="big">' + moneyFull(r.implied_value_usd) + '</div>' +
      '<div class="model-box"><span class="eq">' + esc(eq) + '</span><table>' +
      '<tr><td>TVL</td><td>' + moneyFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Fitted multiple</td><td>' + r.fitted_multiple.toFixed(3) + 'x — ' + esc(r.multiple_source) + '</td></tr>' +
      '<tr><td>7-day growth</td><td>' + pct(r.growth_pct) + ' (fitted weight ' + (coef[3] >= 0 ? '+' : '') + coef[3].toFixed(2) + ')</td></tr>' +
      '<tr><td>Age</td><td>' + ageText(r.age_days) + ' with no token (fitted weight ' + (coef[2] >= 0 ? '+' : '') + coef[2].toFixed(2) + ' on ln(1+age))</td></tr>' +
      '<tr><td>Chains</td><td>' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' (fitted weight ' + (coef[4] >= 0 ? '+' : '') + coef[4].toFixed(2) + ' per extra chain)</td></tr>' +
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
