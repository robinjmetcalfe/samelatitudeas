// City comparison — pick up to 10 cities, compare their historical trends.
// Exposes window.CityCompare for app.js to hook checkboxes into.

(function () {
  'use strict';

  const MAX = 10;
  const STORE_KEY = 'compareList';
  // Distinct, theme-agnostic palette (up to 10 cities).
  const PALETTE = [
    '#fb923c', '#60a5fa', '#34d399', '#f472b6', '#a78bfa',
    '#facc15', '#22d3ee', '#fb7185', '#4ade80', '#c084fc'
  ];

  let selected = load();
  const changeCbs = [];
  // Per-session fetch cache: key -> {climate, population}
  const dataCache = new Map();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(0, MAX) : [];
    } catch (e) { return []; }
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(selected));
  }

  function key(city) {
    return `${city.name}|${(+city.lat).toFixed(2)}|${(+city.lng).toFixed(2)}`;
  }
  function indexOf(city) {
    const k = key(city);
    return selected.findIndex(c => key(c) === k);
  }
  function has(city) { return indexOf(city) >= 0; }
  function isFull() { return selected.length >= MAX; }

  function colorFor(k) {
    const entry = selected.find(c => key(c) === k);
    return entry ? entry._color : '#888';
  }

  function nextColor() {
    const used = new Set(selected.map(c => c._color));
    return PALETTE.find(p => !used.has(p)) || PALETTE[selected.length % PALETTE.length];
  }

  function toggle(city) {
    const idx = indexOf(city);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      if (isFull()) { flashTray(); return false; }
      selected.push({
        name: city.name, country: city.country,
        lat: +city.lat, lng: +city.lng, population: +city.population,
        min_temp: city.min_temp, max_temp: city.max_temp, avg_temp: city.avg_temp,
        _color: nextColor()
      });
    }
    save();
    renderTray();
    fireChange();
    return true;
  }

  function removeKey(k) {
    selected = selected.filter(c => key(c) !== k);
    save();
    renderTray();
    fireChange();
    if (!modal.classList.contains('hidden')) {
      if (selected.length === 0) closeModal(); else renderModal();
    }
  }

  function clear() {
    selected = [];
    save();
    renderTray();
    fireChange();
    if (!modal.classList.contains('hidden')) closeModal();
  }

  function onChange(cb) { changeCbs.push(cb); }
  function fireChange() { changeCbs.forEach(cb => { try { cb(); } catch (e) {} }); }

  // ---- Temp unit (mirrors app.js localStorage) ----
  function tempUnit() { return localStorage.getItem('tempUnit') || 'c'; }
  function toUnit(c) {
    if (c === null || c === undefined) return null;
    return tempUnit() === 'f' ? (c * 9 / 5 + 32) : c;
  }
  function tLabel() { return tempUnit() === 'f' ? '°F' : '°C'; }

  // ---- Daylight from latitude (zero-cost, on-theme) ----
  // Longest day length (hours) at summer solstice for a given latitude.
  function longestDay(lat) {
    const decl = 23.44 * Math.PI / 180; // solstice declination
    const phi = Math.abs(lat) * Math.PI / 180;
    const x = -Math.tan(phi) * Math.tan(decl);
    if (x <= -1) return 24;
    if (x >= 1) return 0;
    const ha = Math.acos(x);
    return (2 * ha * 180 / Math.PI) / 15;
  }

  // ============================ DOM ============================
  const tray = document.createElement('div');
  tray.className = 'compare-tray hidden';
  document.body.appendChild(tray);

  const modal = document.createElement('div');
  modal.className = 'modal compare-modal hidden';
  modal.innerHTML =
    '<div class="modal-backdrop"></div>' +
    '<div class="modal-content compare-content">' +
      '<button class="modal-close" aria-label="Close">&times;</button>' +
      '<h2>City comparison</h2>' +
      '<div class="compare-legend"></div>' +
      '<div class="compare-body"></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  function flashTray() {
    tray.classList.add('full-flash');
    setTimeout(() => tray.classList.remove('full-flash'), 400);
  }

  function renderTray() {
    if (selected.length === 0) { tray.classList.add('hidden'); return; }
    tray.classList.remove('hidden');
    const chips = selected.map(c => {
      const k = key(c);
      return `<span class="compare-chip" style="--c:${c._color}">` +
        `<span class="chip-dot"></span>${escapeHtml(c.name)}` +
        `<button class="chip-x" data-k="${escapeAttr(k)}" aria-label="Remove">&times;</button></span>`;
    }).join('');
    tray.innerHTML =
      `<div class="tray-label">Compare <span class="tray-count">${selected.length}/${MAX}</span></div>` +
      `<div class="tray-chips">${chips}</div>` +
      `<div class="tray-actions">` +
        `<button class="tray-clear">Clear all</button>` +
        `<button class="tray-go"${selected.length < 2 ? ' disabled' : ''}>Compare &rarr;</button>` +
      `</div>`;
    tray.querySelectorAll('.chip-x').forEach(b =>
      b.addEventListener('click', () => removeKey(b.dataset.k)));
    tray.querySelector('.tray-clear').addEventListener('click', clear);
    tray.querySelector('.tray-go').addEventListener('click', openModal);
  }

  // ============================ Modal ============================
  function openModal() {
    if (selected.length < 2) return;
    modal.classList.remove('hidden');
    renderModal();
    loadAllData();
  }
  function closeModal() { modal.classList.add('hidden'); }

  function renderLegend() {
    const legend = modal.querySelector('.compare-legend');
    legend.innerHTML = selected.map(c => {
      const k = key(c);
      return `<span class="legend-item" style="--c:${c._color}">` +
        `<span class="legend-dot"></span>` +
        `<span class="legend-name">${escapeHtml(c.name)}<span class="legend-country">${escapeHtml(c.country)}</span></span>` +
        `<button class="legend-x" data-k="${escapeAttr(k)}" aria-label="Remove">&times;</button></span>`;
    }).join('');
    legend.querySelectorAll('.legend-x').forEach(b =>
      b.addEventListener('click', () => removeKey(b.dataset.k)));
  }

  function renderModal() {
    renderLegend();
    const body = modal.querySelector('.compare-body');
    // Build skeleton; charts fill in as data arrives.
    body.innerHTML =
      '<div class="compare-summary-wrap"><table class="compare-summary"></table></div>' +
      chartBlock('high', 'Average daily high', tLabel()) +
      chartBlock('low', 'Average daily low', tLabel()) +
      chartBlock('mean', 'Annual mean temperature', tLabel()) +
      chartBlock('precip', 'Annual precipitation', 'mm') +
      chartBlock('pop', 'Population', '') +
      '<p class="compare-note">Climate: NASA POWER (monthly, 1981–present). ' +
      'Population: Wikidata — recent and sparse for smaller places; deep history isn’t reliably available per-city.</p>';
    renderSummary();
    redrawCharts();
  }

  function chartBlock(id, title, unit) {
    return `<div class="chart-block" data-chart="${id}">` +
      `<div class="chart-head"><span class="chart-title">${title}</span>` +
      `<span class="chart-unit">${unit}</span></div>` +
      `<div class="chart-area"><div class="chart-loading">Loading…</div></div></div>`;
  }

  function renderSummary() {
    const table = modal.querySelector('.compare-summary');
    if (!table) return;
    const rows = [];
    rows.push('<tr class="sum-head"><th>City</th><th>Lat</th><th>Elev</th>' +
      `<th>Now low/high</th><th>Warming</th><th>Seasonality</th><th>Longest day</th><th>Population</th></tr>`);
    selected.forEach(c => {
      const k = key(c);
      const d = dataCache.get(k);
      const clim = d && d.climate;
      const elev = clim && clim.elevation != null ? Math.round(clim.elevation) + ' m' : '—';
      const warm = clim && clim.stats && clim.stats.warming_per_decade != null
        ? (clim.stats.warming_per_decade > 0 ? '+' : '') + clim.stats.warming_per_decade + ' ' + tLabelDelta() : '…';
      const seas = clim && clim.stats && clim.stats.seasonality != null
        ? clim.stats.seasonality + tLabel() : '…';
      const low = c.min_temp != null ? Math.round(toUnit(c.min_temp)) : '–';
      const high = c.max_temp != null ? Math.round(toUnit(c.max_temp)) : '–';
      const pop = c.population ? fmtPop(c.population) : '—';
      rows.push(
        `<tr><td><span class="sum-dot" style="background:${c._color}"></span>${escapeHtml(c.name)}` +
        `<span class="sum-country">${escapeHtml(c.country)}</span></td>` +
        `<td>${fmtLat(c.lat)}</td><td>${elev}</td>` +
        `<td>${low}/${high}${tLabel()}</td><td>${warm}</td><td>${seas}</td>` +
        `<td>${longestDay(c.lat).toFixed(1)}h</td><td>${pop}</td></tr>`);
    });
    table.innerHTML = rows.join('');
  }
  function tLabelDelta() { return tempUnit() === 'f' ? '°F/dec' : '°C/dec'; }

  async function loadAllData() {
    let done = 0;
    const total = selected.length;
    await Promise.all(selected.map(async c => {
      const k = key(c);
      if (!dataCache.has(k)) {
        const [climate, population] = await Promise.all([
          fetchJSON(`climate.php?action=climate&lat=${c.lat}&lng=${c.lng}`),
          fetchJSON(`climate.php?action=population&lat=${c.lat}&lng=${c.lng}`)
        ]);
        dataCache.set(k, { climate, population });
      }
      done++;
      // Progressive: update as each city resolves.
      if (!modal.classList.contains('hidden')) { renderSummary(); redrawCharts(); }
    }));
    if (!modal.classList.contains('hidden')) { renderSummary(); redrawCharts(); }
  }

  async function fetchJSON(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  // ---- Build datasets for each chart from cached data ----
  function datasetsFor(metric) {
    const out = [];
    selected.forEach(c => {
      const d = dataCache.get(key(c));
      if (!d) return;
      if (metric === 'pop') {
        const p = d.population;
        if (!p || !p.points || p.points.length === 0) return;
        out.push({ color: c._color, label: c.name,
          points: p.points.map(pt => ({ x: pt.year, y: pt.value })) });
        return;
      }
      const clim = d.climate;
      if (!clim || !clim.series || !clim.series.length) return;
      const pts = clim.series.map(r => {
        let y;
        if (metric === 'high') y = toUnit(r.tmax);
        else if (metric === 'low') y = toUnit(r.tmin);
        else if (metric === 'mean') y = toUnit(r.tmean);
        else if (metric === 'precip') y = r.precip;
        return { x: r.year, y };
      }).filter(p => p.y != null);
      if (pts.length) out.push({ color: c._color, label: c.name, points: pts });
    });
    return out;
  }

  function redrawCharts() {
    [['high'], ['low'], ['mean'], ['precip'], ['pop']].forEach(([id]) => {
      const block = modal.querySelector(`.chart-block[data-chart="${id}"] .chart-area`);
      if (!block) return;
      const ds = datasetsFor(id);
      const anyData = dataCache.size > 0;
      if (ds.length === 0) {
        block.innerHTML = anyData
          ? '<div class="chart-empty">No data</div>'
          : '<div class="chart-loading">Loading…</div>';
        return;
      }
      block.innerHTML = svgLineChart(ds, {
        smooth: id === 'pop' ? false : true,
        markers: id === 'pop',
        integerY: id === 'pop' || id === 'precip'
      });
    });
  }

  // ============================ SVG chart ============================
  function svgLineChart(datasets, opts) {
    opts = opts || {};
    const W = 720, H = 200, padL = 44, padR = 12, padT = 12, padB = 22;
    let xs = [], ys = [];
    datasets.forEach(d => d.points.forEach(p => { xs.push(p.x); ys.push(p.y); }));
    let xMin = Math.min(...xs), xMax = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (xMin === xMax) { xMin -= 1; xMax += 1; }
    // Pad y-domain a touch
    const yPad = (yMax - yMin) * 0.08 || 1;
    yMin -= yPad; yMax += yPad;
    if (opts.integerY && yMin < 0 && Math.min(...ys) >= 0) yMin = 0;

    const px = x => padL + (x - xMin) / (xMax - xMin) * (W - padL - padR);
    const py = y => H - padB - (y - yMin) / (yMax - yMin) * (H - padT - padB);

    // Y gridlines (4)
    let grid = '';
    const yTicks = niceTicks(yMin, yMax, 4);
    yTicks.forEach(t => {
      const yy = py(t);
      grid += `<line class="grid" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>`;
      grid += `<text class="axis-y" x="${padL - 6}" y="${(yy + 3).toFixed(1)}">${fmtTick(t, opts)}</text>`;
    });
    // X labels (start, mid, end)
    let xlab = '';
    [xMin, Math.round((xMin + xMax) / 2), xMax].forEach(t => {
      xlab += `<text class="axis-x" x="${px(t).toFixed(1)}" y="${H - 6}">${t}</text>`;
    });

    const lines = datasets.map(d => {
      const sorted = [...d.points].sort((a, b) => a.x - b.x);
      const path = sorted.map((p, i) =>
        (i ? 'L' : 'M') + px(p.x).toFixed(1) + ' ' + py(p.y).toFixed(1)).join(' ');
      let dots = '';
      if (opts.markers) {
        dots = sorted.map(p =>
          `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="2.5" fill="${d.color}"/>`).join('');
      }
      return `<path d="${path}" fill="none" stroke="${d.color}" stroke-width="1.6" ` +
        `stroke-linejoin="round" stroke-linecap="round" opacity="0.92"/>${dots}`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" class="line-chart" preserveAspectRatio="none">` +
      grid + lines + xlab + `</svg>`;
  }

  function niceTicks(min, max, count) {
    const range = max - min;
    if (range === 0) return [min];
    const step = niceNum(range / count, true);
    const ticks = [];
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }
  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range));
    const frac = range / Math.pow(10, exp);
    let nf;
    if (round) nf = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
    else nf = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  function fmtTick(t, opts) {
    if (opts.integerY) return Math.round(t);
    return (Math.round(t * 10) / 10);
  }

  // ============================ utils ============================
  function fmtPop(p) {
    if (p >= 1e6) return (p / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (p >= 1e3) return Math.round(p / 1e3) + 'k';
    return '' + p;
  }
  function fmtLat(lat) {
    return Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  // Re-render summary/charts if unit toggled while modal open.
  window.addEventListener('storage', () => {
    if (!modal.classList.contains('hidden')) { renderModal(); }
  });

  // Initial paint
  renderTray();

  window.CityCompare = {
    key, has, toggle, isFull, clear, onChange, open: openModal,
    count: () => selected.length
  };
})();
