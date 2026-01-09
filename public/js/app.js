// Latitude Explorer

(function() {
  'use strict';

  // DOM
  const searchInput = document.getElementById('city-search');
  const searchDropdown = document.getElementById('search-dropdown');
  const locationInfo = document.getElementById('location-info');
  const selectedCityEl = document.getElementById('selected-city');
  const selectedCountryEl = document.getElementById('selected-country');
  const selectedLatEl = document.getElementById('selected-lat');
  const popStats = document.getElementById('pop-stats');
  const popNorthBig = document.getElementById('pop-north-big');
  const popSouthBig = document.getElementById('pop-south-big');
  const citiesPanel = document.getElementById('cities-panel');
  const citiesList = document.getElementById('cities-list');
  const tempUnitSelect = document.getElementById('temp-unit');
  const distUnitSelect = document.getElementById('dist-unit');

  // State
  let map;
  let latitudeLine = null;
  let cityMarkers = [];
  let selectedMarker = null;
  let isDragging = false;
  let currentLat = null;
  let currentLng = null;
  let currentCities = [];
  let allCitiesAtLat = []; // Full cache of cities at current latitude

  // Population stats for marker sizing
  let popMin = 1000;
  let popMax = 25000000;

  // User preferences
  let tempUnit = localStorage.getItem('tempUnit') || 'c';
  let distUnit = localStorage.getItem('distUnit') || 'km';

  const LAT_TOLERANCE = 0.5;
  const MAX_ZOOM = 10;
  const MIN_ZOOM = 2;
  const MIN_DOTS = 20; // Minimum cities to show even in sparse regions

  // Cache for latitude queries: { "lat_minPop": [cities] }
  const latCache = new Map();
  const CACHE_MAX_SIZE = 20;

  // Get minimum population based on zoom level
  // Scale: world view shows major cities, zoomed in shows smaller towns
  function getMinPopForZoom(zoom) {
    if (zoom >= 10) return 5000;    // City district level
    if (zoom >= 9) return 15000;    // City level
    if (zoom >= 8) return 50000;    // Metro area
    if (zoom >= 7) return 100000;   // Region
    if (zoom >= 6) return 200000;   // Small country (UK visible)
    if (zoom >= 5) return 300000;   // Large country
    if (zoom >= 4) return 400000;   // Continent
    if (zoom >= 3) return 500000;   // Multi-continent
    return 750000;                  // World view
  }

  // Filter cities by zoom level threshold, with fallbacks for sparse regions
  function filterCitiesForZoom(cities, zoom, excludeName = null) {
    const minPop = getMinPopForZoom(zoom);
    let baseCities = excludeName ? cities.filter(c => c.name !== excludeName) : cities;
    let filtered = baseCities.filter(c => c.population >= minPop);

    // If we have fewer than MIN_DOTS globally, take the top cities by population
    if (filtered.length < MIN_DOTS && baseCities.length > filtered.length) {
      const sorted = [...baseCities].sort((a, b) => b.population - a.population);
      filtered = sorted.slice(0, Math.max(MIN_DOTS, filtered.length));
    }

    // Spatial distribution: fill gaps in sparse longitude regions
    // Divide the world into segments and ensure each has some representation
    const NUM_SEGMENTS = 12; // 30° longitude segments
    const MIN_PER_SEGMENT = 2;
    const filteredSet = new Set(filtered.map(c => `${c.name}-${c.lat}-${c.lng}`));

    // Group cities by longitude segment
    const segments = new Array(NUM_SEGMENTS).fill(null).map(() => ({ filtered: [], all: [] }));
    for (const city of baseCities) {
      const segIdx = Math.floor(((city.lng + 180) % 360) / (360 / NUM_SEGMENTS));
      const safeIdx = Math.max(0, Math.min(NUM_SEGMENTS - 1, segIdx));
      const key = `${city.name}-${city.lat}-${city.lng}`;
      if (filteredSet.has(key)) {
        segments[safeIdx].filtered.push(city);
      }
      segments[safeIdx].all.push(city);
    }

    // Fill sparse segments with additional cities
    const additional = [];
    for (const seg of segments) {
      if (seg.filtered.length < MIN_PER_SEGMENT && seg.all.length > seg.filtered.length) {
        // Sort by population and add top cities not already included
        const sorted = seg.all
          .filter(c => !filteredSet.has(`${c.name}-${c.lat}-${c.lng}`))
          .sort((a, b) => b.population - a.population);
        const needed = MIN_PER_SEGMENT - seg.filtered.length;
        additional.push(...sorted.slice(0, needed));
      }
    }

    if (additional.length > 0) {
      filtered = [...filtered, ...additional];
    }

    return filtered;
  }

  // Init
  function init() {
    initMap();
    initSearch();
    initMapClick();
    initUnitToggles();
    fetchPopStats();
  }

  async function fetchPopStats() {
    try {
      const res = await fetch('api.php?action=stats');
      const data = await res.json();
      popMin = data.min_pop || 1000;
      popMax = data.max_pop || 25000000;
    } catch (e) {
      console.error('Failed to fetch pop stats', e);
    }
  }

  function initUnitToggles() {
    tempUnitSelect.value = tempUnit;
    distUnitSelect.value = distUnit;

    tempUnitSelect.addEventListener('change', function() {
      tempUnit = this.value;
      localStorage.setItem('tempUnit', tempUnit);
      if (currentCities.length) refreshDisplay();
    });

    distUnitSelect.addEventListener('change', function() {
      distUnit = this.value;
      localStorage.setItem('distUnit', distUnit);
      if (currentCities.length) refreshDisplay();
    });
  }

  function refreshDisplay() {
    if (currentCities.length && currentLat !== null) {
      updateCitiesList(getVisibleCities());
      updateMarkerTooltips();
    }
  }

  // Update tooltips when units change
  function updateMarkerTooltips() {
    cityMarkers.forEach(marker => {
      const city = marker._cityData;
      if (city) {
        const distStr = formatDistance(city.lat, currentLat);
        const tempStr = formatTemps(estimateTemps(city.lat));
        marker.setTooltipContent(
          `<strong>${city.name}</strong><br>${formatPopulation(city.population)} pop · ${distStr}<br>${tempStr}`
        );
      }
    });
  }

  let highlightedMarker = null;
  let selectedCityMarker = null;

  function initMap() {
    map = L.map('map', {
      center: [30, 0],
      zoom: 3,
      minZoom: MIN_ZOOM,
      maxZoom: 12,
      zoomControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);

    map.zoomControl.setPosition('topright');

    // Update on map move/zoom
    map.on('move', updateLabelPositions);
    map.on('zoomend', onZoomEnd);
    map.on('moveend', onMoveEnd);

    // Proximity-based marker highlighting
    map.on('mousemove', handleProximityHighlight);
    map.getContainer().addEventListener('mouseleave', clearProximityHighlight);
  }

  // On zoom change, update visible cities and redraw markers
  function onZoomEnd() {
    if (currentLat !== null && allCitiesAtLat.length > 0) {
      const filtered = filterCitiesForZoom(allCitiesAtLat, map.getZoom());
      currentCities = filtered;
      updateCitiesList(getVisibleCities());
      redrawMarkers(filtered);
    }
  }

  // On pan, update sidebar to show visible cities
  function onMoveEnd() {
    if (currentLat !== null && currentCities.length > 0) {
      updateCitiesList(getVisibleCities());
    }
  }

  function handleProximityHighlight(e) {
    if (cityMarkers.length === 0) return;

    const mousePoint = e.containerPoint;
    const maxDistPx = Math.min(window.innerWidth, window.innerHeight) * 0.1; // 10vmin

    let nearestMarker = null;
    let nearestDist = Infinity;

    cityMarkers.forEach(marker => {
      const markerPoint = map.latLngToContainerPoint(marker.getLatLng());
      const dist = Math.sqrt(
        Math.pow(mousePoint.x - markerPoint.x, 2) +
        Math.pow(mousePoint.y - markerPoint.y, 2)
      );
      if (dist < nearestDist && dist <= maxDistPx) {
        nearestDist = dist;
        nearestMarker = marker;
      }
    });

    if (highlightedMarker && highlightedMarker !== nearestMarker && highlightedMarker !== selectedCityMarker) {
      highlightedMarker.setStyle({
        fillColor: highlightedMarker._origColor,
        fillOpacity: 0.9
      });
      highlightedMarker.closeTooltip();
    }

    if (nearestMarker && nearestMarker !== selectedCityMarker) {
      const glow = 1 - (nearestDist / maxDistPx);
      // Only update style, not tooltip, if same marker (prevents flicker)
      if (nearestMarker === highlightedMarker) {
        nearestMarker.setStyle({
          fillOpacity: 0.5 + glow * 0.5
        });
      } else {
        nearestMarker.setStyle({
          fillColor: '#ffffff',
          fillOpacity: 0.5 + glow * 0.5
        });
        nearestMarker.openTooltip();
        highlightedMarker = nearestMarker;
      }
    } else if (!nearestMarker) {
      highlightedMarker = null;
    }
  }

  function clearProximityHighlight() {
    if (highlightedMarker && highlightedMarker !== selectedCityMarker) {
      highlightedMarker.setStyle({
        fillColor: highlightedMarker._origColor,
        fillOpacity: 0.9
      });
      highlightedMarker.closeTooltip();
      highlightedMarker = null;
    }
  }

  function updateLabelPositions() {
    if (currentLat === null) return;

    const bandTop = currentLat + 0.5;
    const bandBottom = currentLat - 0.5;

    const topPoint = map.latLngToContainerPoint([bandTop, 0]);
    const bottomPoint = map.latLngToContainerPoint([bandBottom, 0]);

    const gap = window.innerHeight * 0.025;
    const labelHeight = 30;
    popNorthBig.style.top = Math.max(10, topPoint.y - labelHeight - gap) + 'px';
    popSouthBig.style.top = Math.min(bottomPoint.y + gap, map.getContainer().offsetHeight - labelHeight) + 'px';
  }

  function initMapClick() {
    map.on('dragstart', function() {
      isDragging = true;
    });

    map.on('dragend', function() {
      setTimeout(() => { isDragging = false; }, 50);
    });

    map.on('click', function(e) {
      if (isDragging) return;

      const clickPoint = e.containerPoint;
      const maxDistPx = window.innerWidth * 0.05;

      let nearestMarker = null;
      let nearestDist = Infinity;

      cityMarkers.forEach(marker => {
        const markerPoint = map.latLngToContainerPoint(marker.getLatLng());
        const dist = Math.sqrt(
          Math.pow(clickPoint.x - markerPoint.x, 2) +
          Math.pow(clickPoint.y - markerPoint.y, 2)
        );
        if (dist < nearestDist && dist <= maxDistPx) {
          nearestDist = dist;
          nearestMarker = marker;
        }
      });

      if (nearestMarker) {
        highlightSelectedMarker(nearestMarker);
        nearestMarker.openTooltip();
      } else {
        selectLatitude(e.latlng.lat, e.latlng.lng);
      }
    });
  }

  function highlightSelectedMarker(marker) {
    if (selectedCityMarker && selectedCityMarker !== marker) {
      selectedCityMarker.setStyle({
        fillColor: selectedCityMarker._origColor,
        fillOpacity: 0.9
      });
    }
    marker.setStyle({
      fillColor: '#22d3ee',
      fillOpacity: 1
    });
    selectedCityMarker = marker;
  }

  function clearSelectedMarker() {
    if (selectedCityMarker) {
      selectedCityMarker.setStyle({
        fillColor: selectedCityMarker._origColor,
        fillOpacity: 0.9
      });
      selectedCityMarker = null;
    }
  }

  // Get cache key for latitude query
  function getCacheKey(lat) {
    return Math.round(lat * 10) / 10; // Round to 0.1 degree
  }

  // Fetch cities with caching
  async function fetchCitiesAtLatitude(lat) {
    const cacheKey = getCacheKey(lat);

    if (latCache.has(cacheKey)) {
      return latCache.get(cacheKey);
    }

    // Fetch with low minPop to get most cities for caching
    const res = await fetch(`api.php?action=latitude&lat=${lat}&tolerance=${LAT_TOLERANCE}&minPop=5000`);
    const cities = await res.json();

    // Manage cache size
    if (latCache.size >= CACHE_MAX_SIZE) {
      const firstKey = latCache.keys().next().value;
      latCache.delete(firstKey);
    }
    latCache.set(cacheKey, cities);

    return cities;
  }

  // Clear cache (for debugging)
  window.clearLatCache = function() {
    latCache.clear();
    console.log('Latitude cache cleared');
  };

  async function selectLatitude(lat, lng) {
    searchInput.value = '';
    currentLat = lat;
    currentLng = lng;

    selectedCityEl.textContent = '';
    selectedCountryEl.textContent = '';
    selectedLatEl.textContent = formatLat(lat);
    locationInfo.classList.remove('hidden');

    try {
      const allCities = await fetchCitiesAtLatitude(lat);
      allCitiesAtLat = allCities;

      const filtered = filterCitiesForZoom(allCities, map.getZoom());
      currentCities = filtered;

      updatePopStats(lat, allCities);
      updateCitiesList(getVisibleCities());
      citiesPanel.classList.remove('hidden');
      updateMapForLatitude(lat, lng, filtered);
    } catch (e) {
      console.error('Failed to fetch cities', e);
    }
  }

  // Search
  function initSearch() {
    let activeIndex = -1;
    let filteredCities = [];
    let searchTimeout = null;

    searchInput.addEventListener('input', function() {
      const query = this.value.trim();

      if (query.length < 1) {
        hideDropdown();
        return;
      }

      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        try {
          const res = await fetch(`api.php?action=search&q=${encodeURIComponent(query)}`);
          filteredCities = await res.json();

          if (filteredCities.length === 0) {
            hideDropdown();
            return;
          }

          searchDropdown.innerHTML = filteredCities.map((city, i) => `
            <div class="dropdown-item ${i === activeIndex ? 'active' : ''}" data-index="${i}">
              <span class="city">${city.name}</span>
              <span class="country">${city.country}</span>
            </div>
          `).join('');

          showDropdown();
          activeIndex = -1;
        } catch (e) {
          console.error('Search failed', e);
        }
      }, 150);
    });

    searchInput.addEventListener('keydown', function(e) {
      const items = searchDropdown.querySelectorAll('.dropdown-item');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        updateActiveItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActiveItem(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && filteredCities[activeIndex]) {
          selectCity(filteredCities[activeIndex]);
        } else if (filteredCities.length > 0) {
          selectCity(filteredCities[0]);
        }
      } else if (e.key === 'Escape') {
        hideDropdown();
        searchInput.blur();
      }
    });

    searchDropdown.addEventListener('click', function(e) {
      const item = e.target.closest('.dropdown-item');
      if (item) {
        const index = parseInt(item.dataset.index);
        selectCity(filteredCities[index]);
      }
    });

    document.addEventListener('click', function(e) {
      if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        hideDropdown();
      }
    });

    searchInput.addEventListener('focus', function() {
      if (this.value.trim().length >= 1 && searchDropdown.children.length > 0) {
        showDropdown();
      }
    });

    function updateActiveItem(items) {
      items.forEach((item, i) => {
        item.classList.toggle('active', i === activeIndex);
      });
      if (items[activeIndex]) {
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function showDropdown() {
    searchDropdown.classList.remove('hidden');
  }

  function hideDropdown() {
    searchDropdown.classList.add('hidden');
  }

  async function selectCity(city) {
    const { name, country, lat, lng, population } = city;

    searchInput.value = name;
    hideDropdown();

    currentLat = lat;
    currentLng = lng;

    selectedCityEl.textContent = name;
    selectedCountryEl.textContent = country;
    selectedLatEl.textContent = formatLat(lat);
    locationInfo.classList.remove('hidden');

    try {
      const allCities = await fetchCitiesAtLatitude(lat);
      allCitiesAtLat = allCities;

      const filtered = filterCitiesForZoom(allCities, map.getZoom(), name);
      currentCities = filtered;

      updatePopStats(lat, allCities);
      updateCitiesList(getVisibleCities());
      citiesPanel.classList.remove('hidden');
      updateMap(lat, lng, city, filtered);
    } catch (e) {
      console.error('Failed to fetch cities', e);
    }
  }

  function updatePopStats(lat, cities) {
    const stats = getPopulationStats(lat);
    const statsAbove = getPopulationStats(lat + 1);

    const bandPercent = Math.abs(stats.percentNorth - statsAbove.percentNorth);
    const worldPop = 8000000000;
    const latitudeEstimate = Math.round(bandPercent / 100 * worldPop);

    // Sum population from cities we have (5000+ pop)
    const knownCityPop = cities.reduce((sum, c) => sum + c.population, 0);

    // Estimate coverage: cities 5000+ typically capture 50-70% of total population
    // Higher in developed/urban regions, lower in rural regions
    // Use ratio of known to expected to gauge urbanization level
    const rawRatio = knownCityPop / latitudeEstimate;

    // Clamp ratio and estimate total based on typical urban capture rates
    // If rawRatio > 0.7, area is highly urban - our data captures most
    // If rawRatio < 0.3, area is rural - significant pop in small settlements
    let estimatedBandPop, errorMargin;

    if (rawRatio > 0.6) {
      // Urban area: our city data is fairly complete
      // Scale up slightly for small towns we're missing
      estimatedBandPop = Math.round(knownCityPop / 0.75);
      errorMargin = Math.round(estimatedBandPop * 0.08);
    } else if (rawRatio > 0.3) {
      // Mixed area: blend estimates
      const cityBasedEstimate = Math.round(knownCityPop / 0.55);
      estimatedBandPop = Math.round((latitudeEstimate + cityBasedEstimate) / 2);
      errorMargin = Math.round(Math.abs(latitudeEstimate - cityBasedEstimate) / 3);
    } else {
      // Rural/sparse area: rely more on latitude data
      estimatedBandPop = latitudeEstimate;
      errorMargin = Math.round(latitudeEstimate * 0.12);
    }

    // Ensure minimum reasonable error margin
    errorMargin = Math.max(errorMargin, Math.round(estimatedBandPop * 0.05));

    const northRounded = Math.max(0.1, Math.round(stats.percentNorth * 10) / 10);
    const southRounded = Math.max(0.1, Math.min(99.9, Math.round((100 - northRounded) * 10) / 10));

    popNorthBig.innerHTML = northRounded.toFixed(1) + '%<span class="pop-label"> pop to north</span>';
    popSouthBig.innerHTML = southRounded.toFixed(1) + '%<span class="pop-label"> pop to south</span>';
    popNorthBig.classList.remove('hidden');
    popSouthBig.classList.remove('hidden');

    popStats.innerHTML = `
      <span class="pop-value band">${formatPopulation(estimatedBandPop)}</span>
      <span class="pop-text"> ±${formatPopulation(errorMargin)} at this latitude</span>
    `;
    popStats.classList.remove('hidden');

    setTimeout(updateLabelPositions, 100);
  }

  // Get cities for sidebar: all visible dots + major cities (500k+) outside viewport
  const SIDEBAR_MIN_POP_OFFSCREEN = 500000;

  function getVisibleCities() {
    const bounds = map.getBounds();
    const visibleSet = new Set();
    const result = [];

    // First add all cities that are currently displayed as dots (in currentCities) AND visible
    currentCities.forEach(city => {
      const inView = city.lng >= bounds.getWest() && city.lng <= bounds.getEast();
      if (inView) {
        result.push(city);
        visibleSet.add(`${city.name}-${city.lat}-${city.lng}`);
      }
    });

    // Then add large cities (500k+) from the full list that aren't in viewport
    allCitiesAtLat.forEach(city => {
      const key = `${city.name}-${city.lat}-${city.lng}`;
      if (!visibleSet.has(key) && city.population >= SIDEBAR_MIN_POP_OFFSCREEN) {
        result.push(city);
      }
    });

    // Sort by population descending
    return result.sort((a, b) => b.population - a.population);
  }

  function updateCitiesList(cities) {
    const bounds = map.getBounds();
    citiesList.innerHTML = cities.slice(0, 100).map(city => {
      const { name, country, lat, lng, population } = city;
      const distStr = formatDistance(lat, currentLat);
      const tempStr = formatTemps(estimateTemps(lat));
      const inViewport = lng >= bounds.getWest() && lng <= bounds.getEast();
      const offscreenClass = inViewport ? '' : ' offscreen';
      return `
        <li class="city-item${offscreenClass}" data-lat="${lat}" data-lng="${lng}" data-name="${name}">
          <div class="info">
            <div class="name">${name}</div>
            <div class="country">${country}</div>
          </div>
          <div class="meta">
            <span class="pop">${formatPopulation(population)} pop</span>
            <span class="dist">${distStr}</span>
            <span class="temp" title="Average annual min/max temps">${tempStr}</span>
          </div>
        </li>
      `;
    }).join('');

    citiesList.querySelectorAll('.city-item').forEach(item => {
      item.addEventListener('click', function() {
        const lat = parseFloat(this.dataset.lat);
        const lng = parseFloat(this.dataset.lng);
        const name = this.dataset.name;

        const marker = cityMarkers.find(m => {
          const d = m._cityData;
          return d && d.name === name && Math.abs(d.lat - lat) < 0.001;
        });

        if (marker) {
          highlightSelectedMarker(marker);
          marker.openTooltip();
        }

        map.panTo([currentLat, lng], { duration: 0.5 });
      });
    });
  }

  function getMarkerColor(pop) {
    const logMin = Math.log(popMin);
    const logMax = Math.log(popMax);
    const logPop = Math.log(Math.max(pop, popMin));
    const ratio = Math.min(1, Math.max(0, (logPop - logMin) / (logMax - logMin)));

    const r = Math.round(96 + ratio * (251 - 96));
    const g = Math.round(165 + ratio * (146 - 165));
    const b = Math.round(250 + ratio * (60 - 250));

    return `rgb(${r}, ${g}, ${b})`;
  }

  function getMarkerRadius(pop) {
    const logMin = Math.log(popMin);
    const logMax = Math.log(popMax);
    const logPop = Math.log(Math.max(pop, popMin));
    const ratio = Math.min(1, Math.max(0, (logPop - logMin) / (logMax - logMin)));

    return 4 + ratio * 8;
  }

  // Redraw markers when zoom changes
  function redrawMarkers(cities) {
    clearSelectedMarker();
    cityMarkers.forEach(m => map.removeLayer(m));
    cityMarkers = [];

    cities.forEach(city => {
      const markerColor = getMarkerColor(city.population);
      const markerRadius = getMarkerRadius(city.population);
      const distStr = formatDistance(city.lat, currentLat);
      const tempStr = formatTemps(estimateTemps(city.lat));

      const marker = L.circleMarker([city.lat, city.lng], {
        radius: markerRadius,
        fillColor: markerColor,
        fillOpacity: 0.9,
        stroke: false,
        interactive: false  // Allow clicks to pass through to map
      }).addTo(map);

      marker.bindTooltip(
        `<strong>${city.name}</strong><br>${formatPopulation(city.population)} pop · ${distStr}<br>${tempStr}`,
        { permanent: false, direction: 'top', className: 'city-tooltip' }
      );

      marker._origColor = markerColor;
      marker._cityData = city;
      cityMarkers.push(marker);
    });
  }

  function updateMapForLatitude(lat, lng, matchingCities) {
    clearMapLayers();
    drawLatitudeLine(lat);

    matchingCities.forEach(city => {
      const distStr = formatDistance(city.lat, currentLat);
      const tempStr = formatTemps(estimateTemps(city.lat));
      const markerColor = getMarkerColor(city.population);
      const markerRadius = getMarkerRadius(city.population);

      const marker = L.circleMarker([city.lat, city.lng], {
        radius: markerRadius,
        fillColor: markerColor,
        fillOpacity: 0.9,
        stroke: false,
        interactive: false  // Allow clicks to pass through to map
      }).addTo(map);

      marker.bindTooltip(
        `<strong>${city.name}</strong><br>${formatPopulation(city.population)} pop · ${distStr}<br>${tempStr}`,
        { permanent: false, direction: 'top', className: 'city-tooltip' }
      );

      marker._origColor = markerColor;
      marker._cityData = city;
      cityMarkers.push(marker);
    });

    map.setView([lat, lng], map.getZoom(), { animate: true, duration: 0.3 });
  }

  function updateMap(lat, lng, selectedCity, matchingCities) {
    clearMapLayers();
    drawLatitudeLine(lat);

    const tempStr = formatTemps(estimateTemps(selectedCity.lat));

    selectedMarker = L.circleMarker([selectedCity.lat, selectedCity.lng], {
      radius: getMarkerRadius(selectedCity.population) + 4,
      fillColor: '#fb923c',
      fillOpacity: 1,
      stroke: false,
      interactive: false  // Allow clicks to pass through to map
    }).addTo(map);

    selectedMarker.bindTooltip(
      `<strong>${selectedCity.name}</strong><br>${formatPopulation(selectedCity.population)} pop<br>${tempStr}`,
      { permanent: false, direction: 'top', className: 'city-tooltip' }
    );

    matchingCities.forEach(city => {
      const distStr = formatDistance(city.lat, currentLat);
      const cTempStr = formatTemps(estimateTemps(city.lat));
      const markerColor = getMarkerColor(city.population);
      const markerRadius = getMarkerRadius(city.population);

      const marker = L.circleMarker([city.lat, city.lng], {
        radius: markerRadius,
        fillColor: markerColor,
        fillOpacity: 0.9,
        stroke: false,
        interactive: false  // Allow clicks to pass through to map
      }).addTo(map);

      marker.bindTooltip(
        `<strong>${city.name}</strong><br>${formatPopulation(city.population)} pop · ${distStr}<br>${cTempStr}`,
        { permanent: false, direction: 'top', className: 'city-tooltip' }
      );

      marker._origColor = markerColor;
      marker._cityData = city;
      cityMarkers.push(marker);
    });

    const targetZoom = Math.min(Math.max(map.getZoom(), 3), MAX_ZOOM);
    map.flyTo([lat, lng], targetZoom, { duration: 0.6 });
  }

  function drawLatitudeLine(lat) {
    const halfWidth = 0.5;
    // Extend to cover 3 world tiles (left, center, right) for seamless wrapping
    latitudeLine = L.polygon([
      [lat - halfWidth, -540],
      [lat - halfWidth, 540],
      [lat + halfWidth, 540],
      [lat + halfWidth, -540]
    ], {
      stroke: false,
      fillColor: 'rgba(255, 255, 255, 0.15)',
      fillOpacity: 1
    }).addTo(map);
  }

  function clearMapLayers() {
    if (latitudeLine) {
      map.removeLayer(latitudeLine);
      latitudeLine = null;
    }
    if (selectedMarker) {
      map.removeLayer(selectedMarker);
      selectedMarker = null;
    }
    cityMarkers.forEach(m => map.removeLayer(m));
    cityMarkers = [];
    selectedCityMarker = null;
  }

  function formatLat(lat) {
    const dir = lat >= 0 ? 'N' : 'S';
    return Math.abs(lat).toFixed(2) + '°' + dir;
  }

  function formatPopulation(pop) {
    if (pop >= 1000000) {
      return (pop / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (pop >= 1000) {
      return Math.round(pop / 1000) + 'k';
    }
    return pop.toString();
  }

  function formatDistance(cityLat, refLat) {
    if (refLat === null) return '';
    const diff = cityLat - refLat;
    const km = Math.abs(diff * 111);
    const dir = diff > 0 ? 'N' : diff < 0 ? 'S' : '';
    if (km < 1) return 'same';

    if (distUnit === 'mi') {
      const mi = km * 0.621371;
      return Math.round(mi) + 'mi ' + dir;
    }
    return Math.round(km) + 'km ' + dir;
  }

  function estimateTemps(lat) {
    const absLat = Math.abs(lat);

    // Temperature bands based on real city data (averaging maritime/continental)
    // Format: [latitude, winter_low_C, summer_high_C]
    const bands = [
      [0, 22, 32],   // Tropical equator
      [10, 20, 33],  // Tropical
      [20, 12, 35],  // Subtropical desert
      [30, 5, 33],   // Subtropical
      [40, 0, 28],   // Temperate
      [50, -4, 24],  // Cool temperate
      [60, -8, 22],  // Subarctic (Stockholm/St Pete avg)
      [70, -18, 15], // Arctic
      [90, -35, 5]   // Polar
    ];

    for (let i = 0; i < bands.length - 1; i++) {
      if (absLat >= bands[i][0] && absLat < bands[i + 1][0]) {
        const t = (absLat - bands[i][0]) / (bands[i + 1][0] - bands[i][0]);
        const minC = Math.round(bands[i][1] + t * (bands[i + 1][1] - bands[i][1]));
        const maxC = Math.round(bands[i][2] + t * (bands[i + 1][2] - bands[i][2]));
        return { minC, maxC };
      }
    }

    return { minC: -30, maxC: 5 };
  }

  function formatTemps(temps) {
    let min, max, unit;

    if (tempUnit === 'f') {
      min = Math.round(temps.minC * 9/5 + 32);
      max = Math.round(temps.maxC * 9/5 + 32);
      unit = '°F';
    } else {
      min = temps.minC;
      max = temps.maxC;
      unit = '°C';
    }

    return `<span class="cold">${min}${unit}</span> / <span class="hot">${max}${unit}</span>`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
