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
  const minPopSelect = document.getElementById('min-pop');

  // State
  let map;
  let latitudeLine = null;
  let cityMarkers = [];
  let selectedMarker = null;
  let isDragging = false;
  let mouseDownPos = null;
  let currentLat = null;
  let currentLng = null;
  let currentCities = [];

  // Population stats for marker sizing
  let popMin = 50000;
  let popMax = 40000000;

  // User preferences
  let tempUnit = localStorage.getItem('tempUnit') || 'c';
  let distUnit = localStorage.getItem('distUnit') || 'km';
  let minPopFilter = parseInt(localStorage.getItem('minPop')) || 500000;

  const LAT_TOLERANCE = 0.5;
  const MAX_ZOOM = 5;
  const MIN_ZOOM = 2;

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
      popMin = data.min_pop || 50000;
      popMax = data.max_pop || 40000000;
    } catch (e) {
      console.error('Failed to fetch pop stats', e);
    }
  }

  function initUnitToggles() {
    tempUnitSelect.value = tempUnit;
    distUnitSelect.value = distUnit;
    minPopSelect.value = minPopFilter;

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

    minPopSelect.addEventListener('change', function() {
      minPopFilter = parseInt(this.value);
      localStorage.setItem('minPop', minPopFilter);
      if (currentLat !== null) {
        selectLatitude(currentLat, currentLng);
      }
    });
  }

  function refreshDisplay() {
    if (currentCities.length && currentLat !== null) {
      updateCitiesList(currentCities);
    }
  }

  let highlightedMarker = null;
  let selectedCityMarker = null; // For search/click selection highlight

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

    // Update label positions when map moves
    map.on('move zoom', updateLabelPositions);

    // Proximity-based marker highlighting
    map.on('mousemove', handleProximityHighlight);
    map.getContainer().addEventListener('mouseleave', clearProximityHighlight);
  }

  function handleProximityHighlight(e) {
    if (cityMarkers.length === 0) return;

    const mousePoint = e.containerPoint;
    const maxDistPx = window.innerWidth * 0.025; // 2.5vw in pixels

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

    // Clear previous highlight
    if (highlightedMarker && highlightedMarker !== nearestMarker) {
      highlightedMarker.setStyle({
        fillColor: highlightedMarker._origColor,
        fillOpacity: 0.9
      });
      highlightedMarker.closeTooltip();
    }

    // Highlight nearest marker
    if (nearestMarker) {
      const glow = 1 - (nearestDist / maxDistPx); // 1 when close, 0 when far
      nearestMarker.setStyle({
        fillColor: '#ffffff',
        fillOpacity: 0.5 + glow * 0.5
      });
      nearestMarker.openTooltip();
      highlightedMarker = nearestMarker;
    } else {
      highlightedMarker = null;
    }
  }

  function clearProximityHighlight() {
    if (highlightedMarker) {
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

    // Position north label above band, south label below band - equidistant
    const labelHeight = 30;
    const gap = 8;
    popNorthBig.style.top = Math.max(10, topPoint.y - labelHeight - gap) + 'px';
    popSouthBig.style.top = Math.min(bottomPoint.y + gap, map.getContainer().offsetHeight - labelHeight) + 'px';
  }

  function initMapClick() {
    let mouseDownPoint = null;

    map.on('mousedown', function(e) {
      mouseDownPos = e.latlng;
      mouseDownPoint = e.containerPoint;
      isDragging = false;
    });

    map.on('mousemove', function(e) {
      if (mouseDownPoint) {
        const dist = Math.sqrt(
          Math.pow(e.containerPoint.x - mouseDownPoint.x, 2) +
          Math.pow(e.containerPoint.y - mouseDownPoint.y, 2)
        );
        if (dist > 5) isDragging = true; // 5 pixels threshold
      }
    });

    map.on('mouseup', function(e) {
      if (!isDragging && mouseDownPos) {
        // Check if click is near an existing city marker
        const clickPoint = e.containerPoint;
        const maxDistPx = window.innerWidth * 0.05; // 5vw

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
          // Select the nearby city
          highlightSelectedMarker(nearestMarker);
          nearestMarker.openTooltip();
        } else {
          // Select latitude at click point
          selectLatitude(e.latlng.lat, e.latlng.lng);
        }
      }
      mouseDownPos = null;
      mouseDownPoint = null;
      isDragging = false;
    });
  }

  function highlightSelectedMarker(marker) {
    // Clear previous selection
    if (selectedCityMarker && selectedCityMarker !== marker) {
      selectedCityMarker.setStyle({
        fillColor: selectedCityMarker._origColor,
        fillOpacity: 0.9
      });
    }
    // Highlight new selection with cyan glow
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

  async function selectLatitude(lat, lng) {
    searchInput.value = '';
    currentLat = lat;
    currentLng = lng;

    selectedCityEl.textContent = '';
    selectedCountryEl.textContent = '';
    selectedLatEl.textContent = formatLat(lat);
    locationInfo.classList.remove('hidden');

    // Fetch cities from API
    try {
      const res = await fetch(`api.php?action=latitude&lat=${lat}&tolerance=${LAT_TOLERANCE}&minPop=${minPopFilter}`);
      const matchingCities = await res.json();
      currentCities = matchingCities;
      updatePopStats(lat, matchingCities);
      updateCitiesList(matchingCities);
      citiesPanel.classList.remove('hidden');
      updateMapForLatitude(lat, lng, matchingCities);
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

      // Debounce API calls
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

    // Fetch cities at this latitude
    try {
      const res = await fetch(`api.php?action=latitude&lat=${lat}&tolerance=${LAT_TOLERANCE}&minPop=${minPopFilter}`);
      const matchingCities = await res.json();
      // Exclude selected city from list
      const otherCities = matchingCities.filter(c => c.name !== name);
      currentCities = otherCities;
      updatePopStats(lat, matchingCities);
      updateCitiesList(otherCities);
      citiesPanel.classList.remove('hidden');
      updateMap(lat, lng, city, otherCities);
    } catch (e) {
      console.error('Failed to fetch cities', e);
    }
  }

  function updatePopStats(lat, cities) {
    const stats = getPopulationStats(lat);
    const statsAbove = getPopulationStats(lat + 1);

    // Calculate band population using latitude data
    // World pop ~8 billion, band is 1 degree
    // Difference in percentNorth between adjacent latitudes gives us band %
    const bandPercent = Math.abs(stats.percentNorth - statsAbove.percentNorth);
    const worldPop = 8000000000;
    const estimatedBandPop = Math.round(bandPercent / 100 * worldPop);
    const errorMargin = Math.round(estimatedBandPop * 0.3); // 30% margin

    // Ensure percentages add to 100%
    const northRounded = Math.round(stats.percentNorth * 10) / 10;
    const southRounded = Math.round((100 - northRounded) * 10) / 10;

    // Big percentage displays
    popNorthBig.innerHTML = northRounded.toFixed(1) + '%<span class="pop-label"> pop to north</span>';
    popSouthBig.innerHTML = southRounded.toFixed(1) + '%<span class="pop-label"> pop to south</span>';
    popNorthBig.classList.remove('hidden');
    popSouthBig.classList.remove('hidden');

    // Stats bar
    popStats.innerHTML = `
      <span class="pop-value band">${formatPopulation(estimatedBandPop)}</span>
      <span class="pop-text"> ±${formatPopulation(errorMargin)} at this latitude</span>
    `;
    popStats.classList.remove('hidden');

    setTimeout(updateLabelPositions, 100);
  }

  function updateCitiesList(cities) {
    citiesList.innerHTML = cities.map(city => {
      const { name, country, lat, lng, population } = city;
      const distStr = formatDistance(lat, currentLat);
      const temps = estimateTemps(lat);
      const tempStr = formatTemps(temps);
      return `
        <li class="city-item" data-lat="${lat}" data-lng="${lng}">
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

        // Find and highlight the corresponding marker
        const marker = cityMarkers.find(m => {
          const d = m._cityData;
          return d && Math.abs(d.lat - lat) < 0.001 && Math.abs(d.lng - lng) < 0.001;
        });

        if (marker) {
          highlightSelectedMarker(marker);
          marker.openTooltip();
        }

        map.flyTo([currentLat, lng], Math.min(map.getZoom() + 1, MAX_ZOOM), { duration: 0.5 });
      });
    });
  }

  // Get marker color based on population (blue -> orange)
  function getMarkerColor(pop) {
    const logMin = Math.log(popMin);
    const logMax = Math.log(popMax);
    const logPop = Math.log(Math.max(pop, popMin));
    const ratio = (logPop - logMin) / (logMax - logMin);

    // Blue (96, 165, 250) -> Orange (251, 146, 60)
    const r = Math.round(96 + ratio * (251 - 96));
    const g = Math.round(165 + ratio * (146 - 165));
    const b = Math.round(250 + ratio * (60 - 250));

    return `rgb(${r}, ${g}, ${b})`;
  }

  // Get marker radius based on population
  function getMarkerRadius(pop) {
    const logMin = Math.log(popMin);
    const logMax = Math.log(popMax);
    const logPop = Math.log(Math.max(pop, popMin));
    const ratio = (logPop - logMin) / (logMax - logMin);

    // Map to pixel range (4 to 12)
    return 4 + ratio * 8;
  }

  function updateMapForLatitude(lat, lng, matchingCities) {
    clearMapLayers();
    drawLatitudeLine(lat);

    matchingCities.forEach((city, index) => {
      const { name, country, lat: cLat, lng: cLng, population } = city;
      const distStr = formatDistance(cLat, currentLat);
      const temps = estimateTemps(cLat);
      const tempStr = formatTemps(temps);
      const markerColor = getMarkerColor(population);
      const markerRadius = getMarkerRadius(population);

      setTimeout(() => {
        const marker = L.circleMarker([cLat, cLng], {
          radius: markerRadius,
          fillColor: markerColor,
          fillOpacity: 0.9,
          stroke: false
        }).addTo(map);

        marker.bindTooltip(`<strong>${name}</strong><br>${formatPopulation(population)} pop · ${distStr}<br>${tempStr}`, {
          permanent: false,
          direction: 'top',
          className: 'city-tooltip'
        });

        // Store original color for proximity highlighting
        marker._origColor = markerColor;
        marker._origRadius = markerRadius;
        marker._cityData = city;

        cityMarkers.push(marker);
      }, index * 10);
    });

    // Center on clicked point, don't change zoom
    map.setView([lat, lng], map.getZoom(), { animate: true, duration: 0.3 });
  }

  function updateMap(lat, lng, selectedCity, matchingCities) {
    clearMapLayers();
    drawLatitudeLine(lat);

    const { name, country, lat: sLat, lng: sLng, population } = selectedCity;
    const temps = estimateTemps(sLat);
    const tempStr = formatTemps(temps);

    // Selected city marker (larger, orange)
    selectedMarker = L.circleMarker([sLat, sLng], {
      radius: getMarkerRadius(population) + 4,
      fillColor: '#fb923c',
      fillOpacity: 1,
      stroke: false
    }).addTo(map);

    selectedMarker.bindTooltip(`<strong>${name}</strong><br>${formatPopulation(population)} pop<br>${tempStr}`, {
      permanent: false,
      direction: 'top',
      className: 'city-tooltip'
    });

    matchingCities.forEach((city, index) => {
      const { name: cName, country: cCountry, lat: cLat, lng: cLng, population: cPop } = city;
      const distStr = formatDistance(cLat, currentLat);
      const cTemps = estimateTemps(cLat);
      const cTempStr = formatTemps(cTemps);
      const markerColor = getMarkerColor(cPop);
      const markerRadius = getMarkerRadius(cPop);

      setTimeout(() => {
        const marker = L.circleMarker([cLat, cLng], {
          radius: markerRadius,
          fillColor: markerColor,
          fillOpacity: 0.9,
          stroke: false
        }).addTo(map);

        marker.bindTooltip(`<strong>${cName}</strong><br>${formatPopulation(cPop)} pop · ${distStr}<br>${cTempStr}`, {
          permanent: false,
          direction: 'top',
          className: 'city-tooltip'
        });

        // Store original color for proximity highlighting
        marker._origColor = markerColor;
        marker._origRadius = markerRadius;
        marker._cityData = city;

        cityMarkers.push(marker);
      }, index * 10);
    });

    // Center on selected city at reasonable zoom
    const targetZoom = Math.min(Math.max(map.getZoom(), 3), MAX_ZOOM);
    map.flyTo([lat, lng], targetZoom, { duration: 0.6 });
  }

  function drawLatitudeLine(lat) {
    const halfWidth = 0.5;
    latitudeLine = L.polygon([
      [lat - halfWidth, -180],
      [lat - halfWidth, 180],
      [lat + halfWidth, 180],
      [lat + halfWidth, -180]
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
  }

  function formatLat(lat) {
    const dir = lat >= 0 ? 'N' : 'S';
    return Math.abs(lat).toFixed(2) + '°' + dir;
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

  // Estimate temperatures based on latitude
  function estimateTemps(lat) {
    const absLat = Math.abs(lat);

    let minC, maxC;

    if (absLat < 10) {
      minC = 22; maxC = 31;
    } else if (absLat < 20) {
      minC = 18; maxC = 33;
    } else if (absLat < 30) {
      minC = 10; maxC = 34;
    } else if (absLat < 40) {
      minC = 4; maxC = 28;
    } else if (absLat < 50) {
      minC = 0; maxC = 23;
    } else if (absLat < 60) {
      minC = -3; maxC = 19;
    } else if (absLat < 70) {
      minC = -12; maxC = 15;
    } else {
      minC = -25; maxC = 8;
    }

    return { minC, maxC };
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

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
