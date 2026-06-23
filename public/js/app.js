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

  // Mobile elements
  const mobilePopStat = document.getElementById('mobile-pop-stat');
  const mobileCitiesPanel = document.getElementById('mobile-cities-panel');
  const mobileCityCard = document.getElementById('mobile-city-card');
  const mobileCityName = mobileCityCard.querySelector('.mobile-city-name');
  const mobileCityMeta = mobileCityCard.querySelector('.mobile-city-meta');
  const mobilePrevBtn = document.getElementById('mobile-prev');
  const mobileNextBtn = document.getElementById('mobile-next');
  const mobileCityDots = document.getElementById('mobile-city-dots');
  const mobileReferenceCity = document.getElementById('mobile-reference-city');

  // Desktop reference city
  const desktopReferenceCity = document.getElementById('reference-city');

  // Modal elements
  const dataModal = document.getElementById('data-modal');
  const dataSourcesLink = document.getElementById('data-sources-link');
  const modalClose = dataModal.querySelector('.modal-close');
  const modalBackdrop = dataModal.querySelector('.modal-backdrop');

  // State
  let map;
  let latitudeLine = null;
  let cityMarkers = [];
  let selectedMarkers = []; // Array for world-wrapped selected markers
  let isDragging = false;
  let currentLat = null;
  let currentLng = null;
  let currentCities = [];
  let allCitiesAtLat = []; // Full cache of cities at current latitude
  let mobileCityIndex = 0; // Current city index for mobile panel
  let mobileCities = []; // Major cities for mobile panel (top 10 by pop)
  let referenceCity = null; // The city we're comparing against

  // Population stats for marker sizing
  let popMin = 1000;
  let popMax = 25000000;

  // User preferences
  let tempUnit = localStorage.getItem('tempUnit') || 'c';
  let distUnit = localStorage.getItem('distUnit') || 'km';
  let theme = localStorage.getItem('theme') || 'dark';
  let tileLayer = null;

  const LAT_TOLERANCE = 0.5;
  const MAX_ZOOM = 10;
  const MIN_ZOOM = 2;
  const MIN_DOTS = 20; // Minimum cities to show even in sparse regions
  const MOBILE_BREAKPOINT = 768;
  const MOBILE_MAX_CITIES = 10; // Max cities to show in mobile panel

  // Check if mobile view
  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  // Cache for latitude queries: { "lat_minPop": [cities] }
  const latCache = new Map();
  const CACHE_MAX_SIZE = 20;

  // Get minimum population based on zoom level
  // Scale: world view shows major cities, zoomed in shows smaller towns
  function getMinPopForZoom(zoom) {
    if (zoom >= 10) return 2000;    // City district level
    if (zoom >= 9) return 8000;     // City level
    if (zoom >= 8) return 25000;    // Metro area
    if (zoom >= 7) return 50000;    // Region
    if (zoom >= 6) return 100000;   // Small country (UK visible)
    if (zoom >= 5) return 150000;   // Large country
    if (zoom >= 4) return 250000;   // Continent
    if (zoom >= 3) return 350000;   // Multi-continent
    return 500000;                  // World view
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
    initTheme();
    initMap();
    initSearch();
    initMapClick();
    initUnitToggles();
    initModal();
    initIntroModal();
    initMobileNav();
    initCompareSync();
    fetchPopStats();
  }

  // Theme toggle
  function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');

    // Apply saved theme on load
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }

    themeToggle.addEventListener('click', function() {
      theme = theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', theme);

      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }

      // Swap map tiles
      if (map && tileLayer) {
        map.removeLayer(tileLayer);
        const tileUrl = theme === 'light'
          ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        tileLayer = L.tileLayer(tileUrl, {
          attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 19
        }).addTo(map);
      }

      // Update latitude band color
      if (latitudeLine) {
        latitudeLine.setStyle({ fillColor: getBandColor() });
      }

      // Update selected markers color
      selectedMarkers.forEach(m => {
        m.setStyle({ fillColor: getSelectedMarkerColor() });
      });

      // Update city markers colors
      markerRegistry.forEach(entry => {
        const newColor = getMarkerColor(entry.city.population);
        entry.options.fillColor = newColor;
        Object.values(entry.markers).forEach(marker => {
          marker.setStyle({ fillColor: newColor });
          marker._origColor = newColor;
        });
      });

      // Update compare-marker ring colour for the new theme
      renderCompareMarkers();
    });
  }

  // Theme-aware colors
  function getHighlightColor() {
    return theme === 'light' ? '#171717' : '#ffffff';
  }

  function getSelectedMarkerColor() {
    return theme === 'light' ? '#ea580c' : '#fb923c';
  }

  function getBandColor() {
    return theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.15)';
  }

  // Intro modal (first visit only)
  function initIntroModal() {
    const introModal = document.getElementById('intro-modal');
    const introStart = document.getElementById('intro-start');

    // Check URL param to force show modal (for testing)
    const urlParams = new URLSearchParams(window.location.search);
    const forceModal = urlParams.get('modal') === '1';

    // Check if user has visited before (unless forced via URL)
    if (!forceModal && localStorage.getItem('introSeen')) {
      introModal.classList.add('hidden');
      return;
    }

    // Show intro modal
    introStart.addEventListener('click', function() {
      introModal.classList.add('hidden');
      localStorage.setItem('introSeen', 'true');
    });

    // Also close on backdrop click
    introModal.querySelector('.modal-backdrop').addEventListener('click', function() {
      introModal.classList.add('hidden');
      localStorage.setItem('introSeen', 'true');
    });
  }

  // Modal functionality
  function initModal() {
    dataSourcesLink.addEventListener('click', function(e) {
      e.preventDefault();
      dataModal.classList.remove('hidden');
    });

    modalClose.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', closeModal);

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !dataModal.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  function closeModal() {
    dataModal.classList.add('hidden');
  }

  // Mobile navigation
  function initMobileNav() {
    // Prevent clicks on mobile panel from reaching the map
    mobileCitiesPanel.addEventListener('click', function(e) {
      e.stopPropagation();
    });
    mobileCitiesPanel.addEventListener('touchend', function(e) {
      e.stopPropagation();
    });

    mobilePrevBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (mobileCityIndex > 0) {
        mobileCityIndex--;
        updateMobileCityCard();
        panToMobileCity();
      }
    });

    mobileNextBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (mobileCityIndex < mobileCities.length - 1) {
        mobileCityIndex++;
        updateMobileCityCard();
        panToMobileCity();
      }
    });

    // Swipe support
    let touchStartX = 0;
    mobileCityCard.addEventListener('touchstart', function(e) {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    mobileCityCard.addEventListener('touchend', function(e) {
      e.stopPropagation();
      const touchEndX = e.changedTouches[0].clientX;
      const diff = touchStartX - touchEndX;
      if (Math.abs(diff) > 50) {
        if (diff > 0 && mobileCityIndex < mobileCities.length - 1) {
          mobileCityIndex++;
        } else if (diff < 0 && mobileCityIndex > 0) {
          mobileCityIndex--;
        }
        updateMobileCityCard();
        panToMobileCity();
      }
    });
  }

  function updateMobileCities(cities, selectedCityName = null) {
    // Get top cities by population, then sort by longitude (west to east)
    mobileCities = [...cities]
      .sort((a, b) => b.population - a.population)
      .slice(0, MOBILE_MAX_CITIES)
      .sort((a, b) => a.lng - b.lng); // Sort west to east

    // If a city was selected, try to show it (even if not in top 10)
    mobileCityIndex = 0;
    if (selectedCityName) {
      // First check if it's already in the list
      const idx = mobileCities.findIndex(c => c.name === selectedCityName);
      if (idx >= 0) {
        mobileCityIndex = idx;
      } else {
        // Add the selected city in the correct longitude position
        const selectedCity = cities.find(c => c.name === selectedCityName);
        if (selectedCity) {
          // Find insertion point by longitude
          let insertIdx = mobileCities.findIndex(c => c.lng > selectedCity.lng);
          if (insertIdx === -1) insertIdx = mobileCities.length;
          mobileCities.splice(insertIdx, 0, selectedCity);
          if (mobileCities.length > MOBILE_MAX_CITIES + 1) {
            // Remove the city furthest from the selected one
            const selectedLng = selectedCity.lng;
            let furthestIdx = 0;
            let furthestDist = 0;
            mobileCities.forEach((c, i) => {
              if (c.name !== selectedCityName) {
                const dist = Math.abs(c.lng - selectedLng);
                if (dist > furthestDist) {
                  furthestDist = dist;
                  furthestIdx = i;
                }
              }
            });
            mobileCities.splice(furthestIdx, 1);
          }
          mobileCityIndex = mobileCities.findIndex(c => c.name === selectedCityName);
        }
      }
    }

    if (mobileCities.length > 0) {
      mobileCitiesPanel.classList.remove('hidden');
      updateMobileCityCard();
      updateMobileDots();
    }
  }

  function updateMobileCityCard() {
    if (mobileCities.length === 0) return;

    const city = mobileCities[mobileCityIndex];
    const tempRangeStr = formatTempRange(city.min_temp, city.max_temp);

    mobileCityName.textContent = `${city.name}, ${city.country}`;
    mobileCityMeta.textContent = `${formatPopulation(city.population)} · ${tempRangeStr}`;

    // Compare toggle (created lazily, reused across cards)
    let cmpBtn = mobileCityCard.querySelector('.mobile-compare');
    if (!cmpBtn) {
      cmpBtn = document.createElement('button');
      cmpBtn.className = 'mobile-compare';
      cmpBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const c = mobileCities[mobileCityIndex];
        if (window.CityCompare && c) { CityCompare.toggle(c); updateMobileCityCard(); }
      });
      mobileCityCard.appendChild(cmpBtn);
    }
    const inCompare = window.CityCompare && CityCompare.has(city);
    cmpBtn.classList.toggle('on', inCompare);
    cmpBtn.textContent = inCompare ? '✓ Comparing' : '+ Compare';

    // Update button states
    mobilePrevBtn.disabled = mobileCityIndex === 0;
    mobileNextBtn.disabled = mobileCityIndex === mobileCities.length - 1;

    updateMobileDots();
  }

  function updateMobileDots() {
    const maxDots = Math.min(mobileCities.length, 7);
    let dotsHtml = '';
    for (let i = 0; i < maxDots; i++) {
      dotsHtml += `<span class="dot${i === mobileCityIndex ? ' active' : ''}"></span>`;
    }
    mobileCityDots.innerHTML = dotsHtml;
  }

  function panToMobileCity() {
    if (mobileCities.length === 0) return;
    const city = mobileCities[mobileCityIndex];
    map.panTo([currentLat, city.lng], { duration: 0.3 });
  }

  function updateMobilePopStat(estimatedPop, errorMargin) {
    if (isMobile()) {
      mobilePopStat.innerHTML = `<span class="pop-value">${formatPopulation(estimatedPop)}</span> ±${formatPopulation(errorMargin)} at this latitude`;
      mobilePopStat.classList.remove('hidden');
    }
  }

  // Update reference city display (both mobile and desktop)
  function updateReferenceCity(city) {
    referenceCity = city;
    const displayName = city ? city.name : '';
    mobileReferenceCity.textContent = displayName;
    desktopReferenceCity.textContent = displayName;
    updateReferenceCompareBtn();

    // Update north/south labels with new place name
    if (!popNorthBig.classList.contains('hidden')) {
      const placeName = city ? city.name : 'here';
      const northText = popNorthBig.innerHTML.match(/^[\d.]+%/);
      const southText = popSouthBig.innerHTML.match(/^[\d.]+%/);
      if (northText) {
        popNorthBig.innerHTML = northText[0] + '<span class="pop-label"> live north of ' + placeName + '</span>';
      }
      if (southText) {
        popSouthBig.innerHTML = southText[0] + '<span class="pop-label"> live south of ' + placeName + '</span>';
      }
    }
  }

  // Find best city near a lat/lng point (balancing distance and population)
  function findBestNearbyCity(lat, lng, cities) {
    if (!cities || cities.length === 0) return null;

    let best = null;
    let bestScore = -Infinity;

    // Convert screen distance threshold to rough lat/lng distance
    // At zoom 3, world is ~2000px wide, so 1 degree ≈ 5.5px
    // We want to consider cities within ~100px at zoom 3
    const maxDistDegrees = 20; // rough threshold in degrees

    cities.forEach(city => {
      const dist = Math.sqrt(
        Math.pow(city.lat - lat, 2) +
        Math.pow(city.lng - lng, 2)
      );

      if (dist > maxDistDegrees) return;

      // Score formula: prefer larger cities, penalize distance
      // log(population) gives reasonable scale (5-17 for 100 to 25M)
      // Divide by distance squared to heavily penalize far cities
      // Add small constant to avoid division by zero for very close cities
      const popScore = Math.log(city.population);
      const distPenalty = Math.pow(dist + 0.5, 1.5);
      const score = popScore / distPenalty;

      if (score > bestScore) {
        bestScore = score;
        best = city;
      }
    });

    return best;
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
        marker.setTooltipContent(buildTooltip(city));
      }
    });
  }

  let highlightedMarker = null;

  function initMap() {
    map = L.map('map', {
      center: [30, 0],
      zoom: 3,
      minZoom: MIN_ZOOM,
      maxZoom: 12,
      zoomControl: true
    });

    const tileUrl = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    tileLayer = L.tileLayer(tileUrl, {
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
    renderCompareMarkers();
  }

  // On pan, update sidebar to show visible cities
  function onMoveEnd() {
    if (currentLat !== null) {
      // Update markers for new world tile offsets
      if (markerRegistry.length > 0) {
        updateWorldWrappedMarkers();
      }
      if (currentCities.length > 0) {
        updateCitiesList(getVisibleCities());
      }
    }
    renderCompareMarkers();
  }

  // Markers for the cities currently in the comparison list (shown on the map,
  // independent of the selected latitude band), coloured to match the modal.
  let compareMarkers = [];
  function renderCompareMarkers() {
    if (!map || !window.CityCompare) return;
    compareMarkers.forEach(m => map.removeLayer(m));
    compareMarkers = [];
    const list = CityCompare.list();
    if (!list.length) return;
    const offsets = getNeededOffsets();
    const stroke = theme === 'light' ? '#171717' : '#ffffff';
    list.forEach(city => {
      offsets.forEach(offset => {
        const marker = L.circleMarker([city.lat, city.lng + offset], {
          radius: 7, color: stroke, weight: 2, fillColor: city.color,
          fillOpacity: 1, interactive: true, pane: 'markerPane'
        }).addTo(map);
        marker.bindTooltip(
          `<strong>${city.name}</strong> <span style="color:var(--text-muted)">${city.country}</span>` +
          `<br><span style="opacity:.7">In comparison</span>`,
          { direction: 'top', className: 'city-tooltip' }
        );
        compareMarkers.push(marker);
      });
    });
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

    if (highlightedMarker && highlightedMarker !== nearestMarker) {
      highlightedMarker.setStyle({
        fillColor: highlightedMarker._origColor,
        fillOpacity: 0.9
      });
      highlightedMarker.closeTooltip();
    }

    if (nearestMarker) {
      const glow = 1 - (nearestDist / maxDistPx);
      // Only update style, not tooltip, if same marker (prevents flicker)
      if (nearestMarker === highlightedMarker) {
        nearestMarker.setStyle({
          fillOpacity: 0.5 + glow * 0.5
        });
      } else {
        nearestMarker.setStyle({
          fillColor: getHighlightColor(),
          fillOpacity: 0.5 + glow * 0.5
        });
        nearestMarker.openTooltip();
        highlightedMarker = nearestMarker;
      }
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
      const tapRadius = 30; // pixels

      // Check if there's already an activated marker (tooltip open) near the click
      // This applies to both mobile and desktop
      if (highlightedMarker && highlightedMarker._cityData) {
        const markerPoint = map.latLngToContainerPoint(highlightedMarker.getLatLng());
        const dist = Math.sqrt(
          Math.pow(clickPoint.x - markerPoint.x, 2) +
          Math.pow(clickPoint.y - markerPoint.y, 2)
        );
        if (dist <= tapRadius) {
          // Use the already highlighted marker's city
          const city = highlightedMarker._cityData;
          const marker = highlightedMarker;
          updateReferenceCity(city);
          map.panTo([city.lat, city.lng], { duration: 0.3 });
          // Keep tooltip open after pan
          setTimeout(() => {
            marker.openTooltip();
          }, 350);
          return; // Don't move band
        }
      }

      // On mobile, check if tap is near a marker - show tooltip and set as reference
      if (isMobile() && cityMarkers.length > 0) {
        let nearestMarker = null;
        let nearestDist = Infinity;

        cityMarkers.forEach(marker => {
          const markerPoint = map.latLngToContainerPoint(marker.getLatLng());
          const dist = Math.sqrt(
            Math.pow(clickPoint.x - markerPoint.x, 2) +
            Math.pow(clickPoint.y - markerPoint.y, 2)
          );
          if (dist < nearestDist && dist <= tapRadius) {
            nearestDist = dist;
            nearestMarker = marker;
          }
        });

        if (nearestMarker && nearestMarker._cityData) {
          // Close any open tooltip first
          cityMarkers.forEach(m => m.closeTooltip());
          // Show tooltip for tapped marker
          nearestMarker.openTooltip();
          // Set as reference city and pan to it
          const city = nearestMarker._cityData;
          updateReferenceCity(city);
          map.panTo([city.lat, city.lng], { duration: 0.3 });
          return; // Don't move band
        }
      }

      // Reposition band on click (desktop always, mobile only if not near marker)
      selectLatitude(e.latlng.lat, e.latlng.lng);
    });
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

  // Check if any city is within screen distance of a point
  function findCitiesWithinScreenDistance(lat, lng, cities, maxScreenDist) {
    const clickPoint = map.latLngToContainerPoint([lat, lng]);
    const nearby = [];

    cities.forEach(city => {
      const cityPoint = map.latLngToContainerPoint([city.lat, city.lng]);
      const dist = Math.sqrt(
        Math.pow(clickPoint.x - cityPoint.x, 2) +
        Math.pow(clickPoint.y - cityPoint.y, 2)
      );
      if (dist <= maxScreenDist) {
        nearby.push({ city, dist });
      }
    });

    return nearby;
  }

  // Find the zoom level needed to show cities near a point
  function findZoomForNearbyCities(lat, lng, allCities, maxScreenDist) {
    const currentZoom = map.getZoom();

    // Try each zoom level from current up to max
    for (let zoom = currentZoom; zoom <= 12; zoom++) {
      const citiesAtZoom = filterCitiesForZoom(allCities, zoom);

      // Check if any of these cities would be within range at this zoom
      for (const city of citiesAtZoom) {
        // Approximate screen distance at this zoom level
        // Each zoom level doubles the scale
        const zoomFactor = Math.pow(2, zoom - currentZoom);
        const degPerPixel = 360 / (256 * Math.pow(2, zoom));
        const distDegrees = Math.sqrt(
          Math.pow(city.lat - lat, 2) +
          Math.pow(city.lng - lng, 2)
        );
        const approxScreenDist = distDegrees / degPerPixel;

        if (approxScreenDist <= maxScreenDist) {
          return { zoom, cities: citiesAtZoom };
        }
      }
    }

    return null;
  }

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

      // Calculate 5vmin in pixels
      const vmin = Math.min(window.innerWidth, window.innerHeight);
      const maxScreenDist = vmin * 0.05; // 5vmin

      let targetZoom = map.getZoom();
      let filtered = filterCitiesForZoom(allCities, targetZoom);

      // Check if any visible cities are within 5vmin of click
      let nearbyCities = findCitiesWithinScreenDistance(lat, lng, filtered, maxScreenDist);

      // If no nearby visible cities, check if zooming in would reveal some
      if (nearbyCities.length === 0) {
        const zoomResult = findZoomForNearbyCities(lat, lng, allCities, maxScreenDist);
        if (zoomResult) {
          targetZoom = zoomResult.zoom;
          filtered = zoomResult.cities;
        }
      }

      currentCities = filtered;

      // Find best nearby city from visible cities (may be null if none nearby)
      const bestCity = findBestNearbyCity(lat, lng, filtered);
      updateReferenceCity(bestCity);

      updatePopStats(lat, allCities);
      updateCitiesList(getVisibleCities());
      updateMobileCities(allCities, bestCity ? bestCity.name : null);
      citiesPanel.classList.remove('hidden');

      // Pan/zoom to best city if found, otherwise to click location
      const targetLng = bestCity ? bestCity.lng : lng;

      clearMapLayers();
      drawLatitudeLine(lat);

      // Create markers for filtered cities
      filtered.forEach(city => {
        const distStr = formatDistance(city.lat, currentLat);
        const tempRangeStr = formatTempRange(city.min_temp, city.max_temp);
        const markerColor = getMarkerColor(city.population);
        const markerRadius = getMarkerRadius(city.population);
        const tooltipContent = buildTooltip(city);

        registerCityMarker(city, {
          radius: markerRadius,
          fillColor: markerColor,
          fillOpacity: 0.9,
          stroke: false,
          interactive: false
        }, tooltipContent);
      });

      // Zoom in if needed, otherwise just pan
      if (targetZoom > map.getZoom()) {
        map.flyTo([lat, targetLng], targetZoom, { duration: 0.5 });
      } else {
        map.setView([lat, targetLng], map.getZoom(), { animate: true, duration: 0.3 });
      }

      // Open tooltip for reference city after map settles
      if (bestCity) {
        setTimeout(() => {
          const center = map.getCenter();
          let bestMarker = null;
          let bestDist = Infinity;

          cityMarkers.forEach(m => {
            if (m._cityData && m._cityData.name === bestCity.name) {
              const markerLng = m.getLatLng().lng;
              const dist = Math.abs(markerLng - center.lng);
              if (dist < bestDist) {
                bestDist = dist;
                bestMarker = m;
              }
            }
          });

          if (bestMarker) {
            bestMarker.openTooltip();
          }
        }, targetZoom > map.getZoom() ? 600 : 150);
      }
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

    // Set searched city as reference
    updateReferenceCity(city);

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
      updateMobileCities(allCities, name);
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

    const placeName = referenceCity ? referenceCity.name : 'here';
    popNorthBig.innerHTML = northRounded.toFixed(1) + '%<span class="pop-label"> live north of ' + placeName + '</span>';
    popSouthBig.innerHTML = southRounded.toFixed(1) + '%<span class="pop-label"> live south of ' + placeName + '</span>';
    popNorthBig.classList.remove('hidden');
    popSouthBig.classList.remove('hidden');

    popStats.innerHTML = `
      <span class="pop-value band">${formatPopulation(estimatedBandPop)}</span>
      <span class="pop-text"> ±${formatPopulation(errorMargin)} at this latitude</span>
    `;
    popStats.classList.remove('hidden');

    // Update mobile pop stat
    updateMobilePopStat(estimatedBandPop, errorMargin);

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
    const shown = cities.slice(0, 100);
    citiesList.innerHTML = shown.map((city, i) => {
      const { name, country, lat, lng, population, min_temp, max_temp } = city;
      const distStr = formatDistance(lat, currentLat);
      const tempRangeStr = formatTempRange(min_temp, max_temp);
      const inViewport = lng >= bounds.getWest() && lng <= bounds.getEast();
      const offscreenClass = inViewport ? '' : ' offscreen';
      const inCompare = window.CityCompare && CityCompare.has(city);
      return `
        <li class="city-item${offscreenClass}" data-ci="${i}">
          <button class="compare-check${inCompare ? ' on' : ''}" data-ci="${i}" aria-label="Add to comparison" title="Add to comparison"></button>
          <div class="info">
            <div class="name">${name}</div>
            <div class="country">${country}</div>
          </div>
          <div class="meta">
            <span class="pop">${formatPopulation(population)} pop</span>
            <span class="dist">${distStr}</span>
            <span class="temp" title="Temperature range: coldest/warmest month (WorldClim)">${tempRangeStr}</span>
          </div>
        </li>
      `;
    }).join('');

    citiesList.querySelectorAll('.compare-check').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const city = shown[parseInt(this.dataset.ci)];
        if (window.CityCompare && city) {
          CityCompare.toggle(city);
          this.classList.toggle('on', CityCompare.has(city));
        }
      });
    });

    citiesList.querySelectorAll('.city-item').forEach(item => {
      item.addEventListener('click', function() {
        const city = shown[parseInt(this.dataset.ci)];
        if (!city) return;
        const { name, lat, lng } = city;

        const marker = cityMarkers.find(m => {
          const d = m._cityData;
          return d && d.name === name && Math.abs(d.lat - lat) < 0.001;
        });

        if (marker) {
          marker.openTooltip();
        }

        map.panTo([currentLat, lng], { duration: 0.5 });
      });
    });
  }

  // Reference-city (currently selected) compare checkbox in the panel header
  const referenceCompareBtn = document.getElementById('reference-compare');
  if (referenceCompareBtn) {
    referenceCompareBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (window.CityCompare && referenceCity) {
        CityCompare.toggle(referenceCity);
        updateReferenceCompareBtn();
      }
    });
  }
  function updateReferenceCompareBtn() {
    if (!referenceCompareBtn) return;
    if (referenceCity && window.CityCompare) {
      referenceCompareBtn.classList.remove('hidden');
      referenceCompareBtn.classList.toggle('on', CityCompare.has(referenceCity));
    } else {
      referenceCompareBtn.classList.add('hidden');
    }
  }

  // Build a map-dot tooltip including a compare toggle button
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function buildTooltip(city) {
    const distStr = formatDistance(city.lat, currentLat);
    const tempRangeStr = formatTempRange(city.min_temp, city.max_temp);
    const on = window.CityCompare && CityCompare.has(city);
    const data = `data-name="${escapeAttr(city.name)}" data-country="${escapeAttr(city.country)}" ` +
      `data-lat="${city.lat}" data-lng="${city.lng}" data-pop="${city.population}" ` +
      `data-min="${city.min_temp == null ? '' : city.min_temp}" data-max="${city.max_temp == null ? '' : city.max_temp}" ` +
      `data-avg="${city.avg_temp == null ? '' : city.avg_temp}"`;
    return `<strong>${city.name}</strong><br>${formatPopulation(city.population)} pop · ${distStr}<br>${tempRangeStr}` +
      `<button class="tip-compare${on ? ' on' : ''}" ${data}>${on ? '✓ In compare' : '+ Compare'}</button>`;
  }

  // Delegated handler for compare buttons inside map tooltips
  document.addEventListener('click', function(e) {
    const btn = e.target.closest ? e.target.closest('.tip-compare') : null;
    if (!btn || !window.CityCompare) return;
    e.preventDefault();
    e.stopPropagation();
    const ds = btn.dataset;
    const city = {
      name: ds.name, country: ds.country,
      lat: parseFloat(ds.lat), lng: parseFloat(ds.lng), population: parseInt(ds.pop),
      min_temp: ds.min === '' ? null : parseFloat(ds.min),
      max_temp: ds.max === '' ? null : parseFloat(ds.max),
      avg_temp: ds.avg === '' ? null : parseFloat(ds.avg)
    };
    CityCompare.toggle(city);
    const on = CityCompare.has(city);
    btn.classList.toggle('on', on);
    btn.textContent = on ? '✓ In compare' : '+ Compare';
  });

  // Keep compare checkboxes in sync when the list changes externally
  function initCompareSync() {
    if (!window.CityCompare) return;
    CityCompare.onChange(function() {
      if (currentLat !== null && currentCities.length) {
        updateCitiesList(getVisibleCities());
      }
      if (mobileCities.length) updateMobileCityCard();
      updateReferenceCompareBtn();
      renderCompareMarkers();
    });
    renderCompareMarkers(); // initial (restores markers for a persisted list)
  }

  function getMarkerColor(pop) {
    const logMin = Math.log(popMin);
    const logMax = Math.log(popMax);
    const logPop = Math.log(Math.max(pop, popMin));
    const ratio = Math.min(1, Math.max(0, (logPop - logMin) / (logMax - logMin)));

    // Vibrant colors for light mode, lighter pastels for dark mode
    if (theme === 'light') {
      // Vibrant blue to vibrant orange
      const r = Math.round(37 + ratio * (249 - 37));
      const g = Math.round(99 + ratio * (115 - 99));
      const b = Math.round(235 + ratio * (22 - 235));
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Light purple-blue to light orange (original)
      const r = Math.round(96 + ratio * (251 - 96));
      const g = Math.round(165 + ratio * (146 - 165));
      const b = Math.round(250 + ratio * (60 - 250));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  function getMarkerRadius(pop) {
    const logMin = Math.log(popMin);
    const logMax = Math.log(popMax);
    const logPop = Math.log(Math.max(pop, popMin));
    const ratio = Math.min(1, Math.max(0, (logPop - logMin) / (logMax - logMin)));

    return 4 + ratio * 8;
  }

  // Dynamic world wrapping - track which offsets each marker has
  // Each marker entry: { city, options, tooltipContent, markers: { offset: leafletMarker } }
  let markerRegistry = [];

  // Calculate which world offsets are needed for current viewport (with buffer)
  function getNeededOffsets() {
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();

    // Add buffer of 1 world width on each side
    const bufferedWest = west - 360;
    const bufferedEast = east + 360;

    const offsets = [];
    // Start from a multiple of 360 below bufferedWest
    const startOffset = Math.floor(bufferedWest / 360) * 360;
    for (let offset = startOffset; offset <= bufferedEast; offset += 360) {
      offsets.push(offset);
    }
    return offsets;
  }

  // Create a single marker at a specific offset
  function createMarkerAtOffset(city, options, tooltipContent, offset) {
    const marker = L.circleMarker([city.lat, city.lng + offset], options).addTo(map);
    marker.bindTooltip(tooltipContent, {
      permanent: false,
      direction: 'top',
      className: 'city-tooltip',
      interactive: true
    });
    marker._origColor = options.fillColor;
    marker._cityData = city;
    marker._worldOffset = offset;
    return marker;
  }

  // Register a city marker (creates at current needed offsets)
  function registerCityMarker(city, options, tooltipContent) {
    const entry = {
      city,
      options,
      tooltipContent,
      markers: {}
    };

    const neededOffsets = getNeededOffsets();
    neededOffsets.forEach(offset => {
      const marker = createMarkerAtOffset(city, options, tooltipContent, offset);
      entry.markers[offset] = marker;
      cityMarkers.push(marker);
    });

    markerRegistry.push(entry);
  }

  // Update all markers for current viewport
  function updateWorldWrappedMarkers() {
    const neededOffsets = getNeededOffsets();
    const neededSet = new Set(neededOffsets);

    markerRegistry.forEach(entry => {
      // Add markers for new offsets
      neededOffsets.forEach(offset => {
        if (!entry.markers[offset]) {
          const marker = createMarkerAtOffset(entry.city, entry.options, entry.tooltipContent, offset);
          entry.markers[offset] = marker;
          cityMarkers.push(marker);
        }
      });

      // Remove markers for offsets no longer needed
      Object.keys(entry.markers).forEach(offsetStr => {
        const offset = parseInt(offsetStr);
        if (!neededSet.has(offset)) {
          const marker = entry.markers[offset];
          map.removeLayer(marker);
          const idx = cityMarkers.indexOf(marker);
          if (idx > -1) cityMarkers.splice(idx, 1);
          delete entry.markers[offset];
        }
      });
    });

    // Also update latitude line if needed
    updateLatitudeLineForViewport();
  }

  // Update latitude line to cover viewport
  function updateLatitudeLineForViewport() {
    if (currentLat === null || !latitudeLine) return;

    const bounds = map.getBounds();
    const west = bounds.getWest() - 720;
    const east = bounds.getEast() + 720;

    // Update the polygon bounds
    const halfWidth = 0.5;
    latitudeLine.setLatLngs([
      [currentLat - halfWidth, west],
      [currentLat - halfWidth, east],
      [currentLat + halfWidth, east],
      [currentLat + halfWidth, west]
    ]);
  }

  // Redraw markers when zoom changes
  function redrawMarkers(cities) {
    // Clear existing markers and registry
    cityMarkers.forEach(m => map.removeLayer(m));
    cityMarkers = [];
    markerRegistry = [];

    cities.forEach(city => {
      const markerColor = getMarkerColor(city.population);
      const markerRadius = getMarkerRadius(city.population);
      const distStr = formatDistance(city.lat, currentLat);
      const tempRangeStr = formatTempRange(city.min_temp, city.max_temp);
      const tooltipContent = buildTooltip(city);

      registerCityMarker(city, {
        radius: markerRadius,
        fillColor: markerColor,
        fillOpacity: 0.9,
        stroke: false,
        interactive: false
      }, tooltipContent);
    });
  }

  // Create static markers at needed offsets (for selected marker, doesn't need dynamic updating)
  function createStaticWrappedMarkers(city, options, tooltipContent) {
    const markers = [];
    const neededOffsets = getNeededOffsets();
    neededOffsets.forEach(offset => {
      const marker = L.circleMarker([city.lat, city.lng + offset], options).addTo(map);
      marker.bindTooltip(tooltipContent, {
        permanent: false,
        direction: 'top',
        className: 'city-tooltip',
      interactive: true
      });
      marker._origColor = options.fillColor;
      marker._cityData = city;
      marker._worldOffset = offset;
      markers.push(marker);
    });
    return markers;
  }

  function updateMapForLatitude(lat, lng, matchingCities) {
    clearMapLayers();
    drawLatitudeLine(lat);

    matchingCities.forEach(city => {
      const distStr = formatDistance(city.lat, currentLat);
      const tempRangeStr = formatTempRange(city.min_temp, city.max_temp);
      const markerColor = getMarkerColor(city.population);
      const markerRadius = getMarkerRadius(city.population);
      const tooltipContent = buildTooltip(city);

      registerCityMarker(city, {
        radius: markerRadius,
        fillColor: markerColor,
        fillOpacity: 0.9,
        stroke: false,
        interactive: false
      }, tooltipContent);
    });

    map.setView([lat, lng], map.getZoom(), { animate: true, duration: 0.3 });
  }

  function updateMap(lat, lng, selectedCity, matchingCities) {
    clearMapLayers();
    drawLatitudeLine(lat);

    const selectedTooltip = buildTooltip(selectedCity);

    // Create selected marker on all world tiles
    selectedMarkers = createStaticWrappedMarkers(selectedCity, {
      radius: getMarkerRadius(selectedCity.population) + 4,
      fillColor: getSelectedMarkerColor(),
      fillOpacity: 1,
      stroke: false,
      interactive: false
    }, selectedTooltip);

    matchingCities.forEach(city => {
      const distStr = formatDistance(city.lat, currentLat);
      const markerColor = getMarkerColor(city.population);
      const markerRadius = getMarkerRadius(city.population);
      const tooltipContent = buildTooltip(city);

      registerCityMarker(city, {
        radius: markerRadius,
        fillColor: markerColor,
        fillOpacity: 0.9,
        stroke: false,
        interactive: false
      }, tooltipContent);
    });

    const targetZoom = Math.min(Math.max(map.getZoom(), 3), MAX_ZOOM);
    map.flyTo([lat, lng], targetZoom, { duration: 0.6 });
  }

  function drawLatitudeLine(lat) {
    const halfWidth = 0.5;
    // Use viewport bounds with large buffer for seamless wrapping
    const bounds = map.getBounds();
    const west = bounds.getWest() - 720;
    const east = bounds.getEast() + 720;

    latitudeLine = L.polygon([
      [lat - halfWidth, west],
      [lat - halfWidth, east],
      [lat + halfWidth, east],
      [lat + halfWidth, west]
    ], {
      stroke: false,
      fillColor: getBandColor(),
      fillOpacity: 1
    }).addTo(map);
  }

  function clearMapLayers() {
    if (latitudeLine) {
      map.removeLayer(latitudeLine);
      latitudeLine = null;
    }
    selectedMarkers.forEach(m => map.removeLayer(m));
    selectedMarkers = [];
    cityMarkers.forEach(m => map.removeLayer(m));
    cityMarkers = [];
    markerRegistry = [];
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

  // Format temperature from WorldClim data
  function formatTemp(avgTempC) {
    if (avgTempC === null || avgTempC === undefined) return '';

    let temp, unit;
    if (tempUnit === 'f') {
      temp = Math.round(avgTempC * 9/5 + 32);
      unit = '°F';
    } else {
      temp = Math.round(avgTempC);
      unit = '°C';
    }

    return `${temp}${unit}`;
  }

  // Format temperature range (min/max)
  function formatTempRange(minTempC, maxTempC) {
    if ((minTempC === null || minTempC === undefined) &&
        (maxTempC === null || maxTempC === undefined)) return '';

    let minTemp, maxTemp, unit;
    if (tempUnit === 'f') {
      minTemp = minTempC !== null ? Math.round(minTempC * 9/5 + 32) : null;
      maxTemp = maxTempC !== null ? Math.round(maxTempC * 9/5 + 32) : null;
      unit = '°';
    } else {
      minTemp = minTempC !== null ? Math.round(minTempC) : null;
      maxTemp = maxTempC !== null ? Math.round(maxTempC) : null;
      unit = '°';
    }

    if (minTemp !== null && maxTemp !== null) {
      return `avg ${minTemp}/${maxTemp}${unit}`;
    } else if (maxTemp !== null) {
      return `max ${maxTemp}${unit}`;
    } else {
      return `min ${minTemp}${unit}`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
