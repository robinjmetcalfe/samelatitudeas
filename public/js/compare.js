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
  // Day length (hours) for a latitude at the middle of a given month (1-12).
  const MID_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
  function dayLengthMonth(lat, m) {
    const doy = MID_DOY[m - 1];
    const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI / 365 * (doy - 81));
    const phi = lat * Math.PI / 180;
    let x = -Math.tan(phi) * Math.tan(decl);
    x = Math.max(-1, Math.min(1, x));
    return (2 * Math.acos(x) * 180 / Math.PI) / 15;
  }
  // Chart definitions, grouped into sections.
  const CHARTS = [
    { id: 'mtemp',  title: 'Mean temperature by month', unit: tLabel, section: 'normals', kind: 'month', field: 'tmean', conv: 'temp', smooth: true, xMonths: true },
    { id: 'mprecip',title: 'Precipitation by month',    unit: 'mm',   section: 'normals', kind: 'month', field: 'precip', smooth: true, xMonths: true, integerY: true },
    { id: 'msun',   title: 'Sunshine hours by month', unit: 'h', section: 'normals', kind: 'month', field: 'sun', smooth: true, xMonths: true, integerY: true },
    { id: 'daylight',title:'Daylight hours by month',   unit: 'h',    section: 'normals', kind: 'daylight', smooth: true, xMonths: true },
    { id: 'high',   title: 'Average daily high',        unit: tLabel, section: 'trends', kind: 'year', field: 'tmax', conv: 'temp', smooth: true },
    { id: 'low',    title: 'Average daily low',         unit: tLabel, section: 'trends', kind: 'year', field: 'tmin', conv: 'temp', smooth: true },
    { id: 'mean',   title: 'Annual mean temperature',   unit: tLabel, section: 'trends', kind: 'year', field: 'tmean', conv: 'temp', smooth: true },
    { id: 'precip', title: 'Annual precipitation',      unit: 'mm',   section: 'trends', kind: 'year', field: 'precip', integerY: true },
    { id: 'solar',  title: 'Solar irradiance',          unit: 'kWh/m²/day', section: 'trends', kind: 'year', field: 'solar' },
    { id: 'wind',   title: 'Wind speed',                unit: 'm/s',  section: 'trends', kind: 'year', field: 'wind' },
    { id: 'humidity',title:'Relative humidity',         unit: '%',    section: 'trends', kind: 'year', field: 'humidity', integerY: true },
    { id: 'pop',    title: 'Population',                unit: '',     section: 'pop', kind: 'pop', markers: true, integerY: true },
  ];
  const SECTIONS = [
    { id: 'normals', title: 'The shape of the year', sub: 'Monthly climate normals (averaged across all years)' },
    { id: 'trends', title: 'How it’s changing', sub: 'Year-by-year since 1981' },
    { id: 'pop', title: 'Population', sub: '' },
  ];

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

  function renderModal() {
    const body = modal.querySelector('.compare-body');
    let html = '<div class="compare-summary-wrap"><table class="compare-summary"></table></div>';
    SECTIONS.forEach(sec => {
      const charts = CHARTS.filter(c => c.section === sec.id);
      if (!charts.length) return;
      html += `<div class="compare-section" data-section="${sec.id}"><div class="section-head"><h3>${sec.title}</h3>` +
        (sec.sub ? `<span class="section-sub">${sec.sub}</span>` : '') + '</div>';
      charts.forEach(c => { html += chartBlock(c); });
      html += '</div>';
    });
    html += '<p class="compare-note">Climate: NASA POWER (monthly, 1981–present); Köppen derived from monthly normals. ' +
      'Sunshine: measured from the nearest weather station (Meteostat normals) where one is within 300 km, ' +
      'otherwise estimated from satellite irradiance (marked ~). ' +
      'Population: GHS-UCDB urban-centre estimates (JRC, 1975–2015) where a centre is within 35 km, else Wikidata.</p>';
    body.innerHTML = html;
    renderSummary();
    redrawCharts();
  }

  function chartBlock(c) {
    const unit = typeof c.unit === 'function' ? c.unit() : c.unit;
    return `<div class="chart-block" data-chart="${c.id}">` +
      `<div class="chart-head"><span class="chart-title">${c.title}</span>` +
      `<span class="chart-unit">${unit}</span></div>` +
      `<div class="chart-area"><div class="chart-loading">Loading…</div></div></div>`;
  }

  function renderSummary() {
    const table = modal.querySelector('.compare-summary');
    if (!table) return;
    const rows = [];
    rows.push('<tr class="sum-head"><th></th><th>City</th><th>Climate</th><th>Lat</th>' +
      `<th>Elev</th><th>Sunshine</th><th>Longest day</th><th>Population</th></tr>`);
    selected.forEach(c => {
      const k = key(c);
      const d = dataCache.get(k);
      const clim = d && d.climate;
      const st = clim && clim.stats;
      const elev = clim && clim.elevation != null ? Math.round(clim.elevation) + ' m' : '…';
      let sun = '…';
      if (st && st.sunshine_annual != null) {
        const v = fmtNum(st.sunshine_annual) + ' h';
        if (st.sunshine_source === 'measured') {
          sun = `<span title="Measured — ${escapeAttr(st.sunshine_station || 'station')} (${st.sunshine_dist} km, ${st.sunshine_period || ''})">${v}</span>`;
        } else {
          sun = `<span class="sun-est" title="Estimated from satellite irradiance (no nearby station)">${v}~</span>`;
        }
      }
      const climate = st && st.koppen
        ? `<span class="climate-cell" title="${escapeAttr((st.koppen_name || '') + ' · Köppen ' + st.koppen)}">${escapeHtml(climateShort(st.koppen, st.koppen_name))}</span>` : '…';
      const pop = c.population ? fmtPop(c.population) : '—';
      rows.push(
        `<tr><td class="sum-rm-cell"><button class="sum-remove" data-k="${escapeAttr(k)}" aria-label="Remove ${escapeAttr(c.name)}">&times;</button></td>` +
        `<td><span class="sum-dot" style="background:${c._color}"></span>${escapeHtml(c.name)}` +
        `<span class="sum-country">${escapeHtml(c.country)}</span></td>` +
        `<td>${climate}</td><td>${fmtLat(c.lat)}</td><td>${elev}</td>` +
        `<td>${sun}</td><td>${longestDay(c.lat).toFixed(1)}h</td><td>${pop}</td></tr>`);
    });
    table.innerHTML = rows.join('');
    table.querySelectorAll('.sum-remove').forEach(b =>
      b.addEventListener('click', () => removeKey(b.dataset.k)));
  }
  function fmtNum(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // Concise climate label per Köppen code (full name + code shown on hover).
  const CLIMATE_SHORT = {
    Af: 'Tropical', Am: 'Tropical', Aw: 'Tropical', As: 'Tropical',
    BWh: 'Hot desert', BWk: 'Cold desert', BSh: 'Hot semi-arid', BSk: 'Cold semi-arid',
    Cfa: 'Humid subtropical', Cfb: 'Oceanic', Cfc: 'Subpolar oceanic',
    Cwa: 'Subtropical', Cwb: 'Subtropical highland', Cwc: 'Subtropical highland',
    Csa: 'Mediterranean', Csb: 'Mediterranean', Csc: 'Mediterranean',
    Dfa: 'Humid continental', Dfb: 'Humid continental', Dfc: 'Subarctic', Dfd: 'Subarctic',
    Dwa: 'Humid continental', Dwb: 'Humid continental', Dwc: 'Subarctic', Dwd: 'Subarctic',
    Dsa: 'Continental', Dsb: 'Continental', Dsc: 'Subarctic', Dsd: 'Subarctic',
    ET: 'Tundra', EF: 'Ice cap',
  };
  function climateShort(code, full) { return CLIMATE_SHORT[code] || full || code; }

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

  // ---- Build datasets for a chart definition from cached data ----
  function datasetsFor(chart) {
    const out = [];
    selected.forEach(c => {
      const d = dataCache.get(key(c));
      // Daylight is pure geometry — always available from latitude.
      if (chart.kind === 'daylight') {
        const pts = [];
        for (let m = 1; m <= 12; m++) pts.push({ x: m, y: dayLengthMonth(c.lat, m) });
        out.push({ color: c._color, label: c.name, points: pts });
        return;
      }
      if (!d) return;
      if (chart.kind === 'pop') {
        const p = d.population;
        if (!p || !p.points || !p.points.length) return;
        out.push({ color: c._color, label: c.name, points: p.points.map(pt => ({ x: pt.year, y: pt.value })) });
        return;
      }
      const clim = d.climate;
      if (chart.kind === 'month') {
        if (!clim || !clim.monthly || !clim.monthly.length) return;
        const pts = clim.monthly.map(r => ({
          x: r.m, y: chart.conv === 'temp' ? toUnit(r[chart.field]) : r[chart.field]
        })).filter(p => p.y != null);
        if (pts.length) out.push({ color: c._color, label: c.name, points: pts });
        return;
      }
      // kind === 'year'
      if (!clim || !clim.series || !clim.series.length) return;
      const pts = clim.series.map(r => ({
        x: r.year, y: chart.conv === 'temp' ? toUnit(r[chart.field]) : r[chart.field]
      })).filter(p => p.y != null);
      if (pts.length) out.push({ color: c._color, label: c.name, points: pts });
    });
    return out;
  }

  const MONTHFULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function redrawCharts() {
    const loadingDone = selected.every(c => dataCache.has(key(c)));
    CHARTS.forEach(chart => {
      const blockEl = modal.querySelector(`.chart-block[data-chart="${chart.id}"]`);
      if (!blockEl) return;
      const area = blockEl.querySelector('.chart-area');
      const ds = datasetsFor(chart);
      if (ds.length === 0) {
        if (loadingDone || chart.kind === 'daylight') {
          blockEl.style.display = 'none';      // hide charts with no data
        } else {
          blockEl.style.display = '';
          area.innerHTML = '<div class="chart-loading">Loading…</div>';
        }
        return;
      }
      blockEl.style.display = '';
      const { svg, geom } = svgLineChart(ds, {
        smooth: chart.smooth, markers: chart.markers,
        integerY: chart.integerY, xMonths: chart.xMonths
      });
      area.innerHTML = buildChartLegend(ds) +
        '<div class="chart-plot">' + svg +
        '<div class="chart-guide"></div><div class="chart-cursor"></div></div>';
      attachHover(area.querySelector('.chart-plot'), chart, ds, geom);
    });
    // Hide section headers whose charts are all hidden
    SECTIONS.forEach(sec => {
      const secEl = modal.querySelector(`.compare-section[data-section="${sec.id}"]`);
      if (!secEl) return;
      const visible = [...secEl.querySelectorAll('.chart-block')].some(b => b.style.display !== 'none');
      secEl.style.display = visible ? '' : 'none';
    });
  }

  function buildChartLegend(datasets) {
    return '<div class="chart-legend">' + datasets.map(d =>
      `<span class="cl-item"><span class="cl-dot" style="background:${d.color}"></span>${escapeHtml(d.label)}</span>`
    ).join('') + '</div>';
  }

  function nearestPoint(points, x) {
    let best = null, bd = Infinity;
    for (const p of points) { const dd = Math.abs(p.x - x); if (dd < bd) { bd = dd; best = p; } }
    return best;
  }

  function formatVal(chart, y) {
    if (chart.id === 'pop') return fmtPop(y);
    if (chart.conv === 'temp') return Math.round(y) + tLabel();
    const u = typeof chart.unit === 'function' ? chart.unit() : chart.unit;
    const v = chart.integerY ? Math.round(y) : Math.round(y * 10) / 10;
    return v + (u ? ' ' + u : '');
  }

  // Hover: vertical guide + tooltip listing each city's value at that x.
  function attachHover(plotEl, chart, datasets, geom) {
    const svg = plotEl.querySelector('svg');
    const guide = plotEl.querySelector('.chart-guide');
    const cursor = plotEl.querySelector('.chart-cursor');
    const xsSet = new Set();
    datasets.forEach(d => d.points.forEach(p => xsSet.add(p.x)));
    const xs = [...xsSet].sort((a, b) => a - b);
    if (!xs.length) return;

    plotEl.addEventListener('mousemove', function (e) {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const vbX = (e.clientX - rect.left) / rect.width * geom.W;
      const frac = (vbX - geom.padL) / (geom.W - geom.padL - geom.padR);
      const dataX = geom.xMin + frac * (geom.xMax - geom.xMin);
      let nx = xs[0];
      for (const x of xs) if (Math.abs(x - dataX) < Math.abs(nx - dataX)) nx = x;
      const pxView = geom.padL + (nx - geom.xMin) / (geom.xMax - geom.xMin) * (geom.W - geom.padL - geom.padR);
      const leftCss = pxView / geom.W * rect.width;
      guide.style.left = leftCss + 'px';
      guide.style.display = 'block';

      const rows = datasets.map(d => {
        const pt = d.points.find(p => p.x === nx) || nearestPoint(d.points, nx);
        return pt ? { color: d.color, label: d.label, val: pt.y } : null;
      }).filter(Boolean).sort((a, b) => b.val - a.val);
      const header = (chart.xMonths) ? MONTHFULL[nx - 1] : nx;
      cursor.innerHTML = `<div class="cur-head">${header}</div>` + rows.map(r =>
        `<div class="cur-row"><span class="cur-dot" style="background:${r.color}"></span>` +
        `<span class="cur-name">${escapeHtml(r.label)}</span>` +
        `<span class="cur-val">${formatVal(chart, r.val)}</span></div>`).join('');
      cursor.style.display = 'block';
      const cw = cursor.offsetWidth;
      let cx = leftCss + 12;
      if (cx + cw > rect.width) cx = leftCss - cw - 12;
      cursor.style.left = Math.max(0, cx) + 'px';
    });
    plotEl.addEventListener('mouseleave', function () {
      guide.style.display = 'none';
      cursor.style.display = 'none';
    });
  }

  // ============================ SVG chart ============================
  function svgLineChart(datasets, opts) {
    opts = opts || {};
    const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    const W = 720, H = 200, padL = 44, padR = 12, padT = 12, padB = 22;
    let xs = [], ys = [];
    datasets.forEach(d => d.points.forEach(p => { xs.push(p.x); ys.push(p.y); }));
    let xMin = Math.min(...xs), xMax = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (opts.xMonths) { xMin = 1; xMax = 12; }
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
    // X labels
    let xlab = '';
    if (opts.xMonths) {
      for (let m = 1; m <= 12; m++) {
        xlab += `<text class="axis-x" x="${px(m).toFixed(1)}" y="${H - 6}">${MONTHS[m - 1]}</text>`;
      }
    } else {
      [xMin, Math.round((xMin + xMax) / 2), xMax].forEach(t => {
        xlab += `<text class="axis-x" x="${px(t).toFixed(1)}" y="${H - 6}">${t}</text>`;
      });
    }

    const lines = datasets.map(d => {
      const sorted = [...d.points].sort((a, b) => a.x - b.x);
      const pts = sorted.map(p => [px(p.x), py(p.y)]);
      const path = opts.smooth ? smoothPath(pts) : pts.map((p, i) =>
        (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      let dots = '';
      if (opts.markers) {
        dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="${d.color}"/>`).join('');
      }
      return `<path d="${path}" fill="none" stroke="${d.color}" stroke-width="1.6" ` +
        `stroke-linejoin="round" stroke-linecap="round" opacity="0.92"/>${dots}`;
    }).join('');

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="line-chart" preserveAspectRatio="none">` +
      grid + lines + xlab + `</svg>`;
    return { svg, geom: { W, H, padL, padR, padT, padB, xMin, xMax, yMin, yMax } };
  }

  // Catmull-Rom -> cubic Bezier smoothing for a series of [x,y] points.
  function smoothPath(pts) {
    if (pts.length < 3) return pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)},${c2x.toFixed(1)} ${c2y.toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
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
