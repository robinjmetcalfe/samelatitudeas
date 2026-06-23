<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">

  <title>Same Latitude As - Find Cities That Share Your Latitude</title>
  <meta name="description" content="Discover which cities around the world share your latitude. See who lives on the same horizontal slice of Earth and what percentage of humanity lives north or south of you.">
  <meta name="keywords" content="latitude, geography, world cities, map, population, same latitude, latitude comparison, global cities">
  <meta name="author" content="Robin Metcalfe">

  <!-- Open Graph -->
  <meta property="og:title" content="Same Latitude As - Who's On Your Level?">
  <meta property="og:description" content="Pick a city and discover which places around the world share your latitude. Find out what percentage of humanity lives north or south of you.">
  <meta property="og:type" content="website">
  <meta property="og:image" content="/intro-screenshot.jpg">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Same Latitude As - Who's On Your Level?">
  <meta name="twitter:description" content="Pick a city and discover which places share your latitude around the globe.">
  <meta name="twitter:image" content="/intro-screenshot.jpg">

  <!-- Theme -->
  <meta name="theme-color" content="#0a0a0a">
  <link rel="canonical" href="https://solarise.dev/samelatitudeas/">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="css/style.css?v=<?= filemtime('css/style.css') ?>">
</head>
<body>

  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <h1 class="desktop-title">Same Latitude As...</h1>
        <div class="search-wrapper">
          <input
            type="text"
            id="city-search"
            placeholder="Enter a city..."
            autocomplete="off"
            spellcheck="false"
          >
          <div id="search-dropdown" class="dropdown hidden"></div>
        </div>
        <div class="unit-toggles">
          <select id="temp-unit">
            <option value="c">°C</option>
            <option value="f">°F</option>
          </select>
          <select id="dist-unit">
            <option value="km">km</option>
            <option value="mi">mi</option>
          </select>
          <button id="theme-toggle" class="theme-toggle" aria-label="Toggle theme">
            <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </button>
        </div>
      </div>

      <div id="location-info" class="location-info hidden">
        <span id="selected-city" class="city-name"></span>
        <span id="selected-country" class="country-name"></span>
        <span id="selected-lat" class="lat-value"></span>
      </div>

      <div id="mobile-pop-stat" class="mobile-pop-stat hidden"></div>
    </header>

    <!-- Main content -->
    <main class="main">
      <!-- Map -->
      <div class="map-container">
        <div id="pop-north-big" class="pop-big north hidden"></div>
        <div id="pop-stats" class="pop-stats hidden"></div>
        <div id="pop-south-big" class="pop-big south hidden"></div>
        <div id="map"></div>
      </div>

      <!-- Side panel (desktop) -->
      <aside id="cities-panel" class="cities-panel hidden">
        <div class="panel-header">
          <div class="reference-row">
            <button class="compare-check hidden" id="reference-compare" aria-label="Add selected city to comparison" title="Add to comparison"></button>
            <div class="reference-city" id="reference-city"></div>
          </div>
          <span class="panel-title">Same Latitude As...</span>
        </div>
        <ul id="cities-list" class="cities-list"></ul>
      </aside>
    </main>

    <!-- Mobile bottom panel -->
    <div id="mobile-cities-panel" class="mobile-cities-panel hidden">
      <div class="mobile-panel-header">
        <div class="mobile-reference-city" id="mobile-reference-city"></div>
        <div class="mobile-panel-title">Same Latitude As...</div>
      </div>
      <div class="mobile-panel-row">
        <button id="mobile-prev" class="mobile-nav-btn prev" aria-label="Previous city">&larr;</button>
        <div id="mobile-city-card" class="mobile-city-card">
          <div class="mobile-city-name"></div>
          <div class="mobile-city-meta"></div>
        </div>
        <button id="mobile-next" class="mobile-nav-btn next" aria-label="Next city">&rarr;</button>
      </div>
      <div class="mobile-city-dots" id="mobile-city-dots"></div>
    </div>

    <footer class="footer">
      <a href="#" id="data-sources-link" class="data-sources-link">Data sources</a>
    </footer>

    <!-- Intro modal (first visit only) -->
    <div id="intro-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content intro-content">
        <h2>Who's on your level?</h2>
        <img src="intro-screenshot.jpg" alt="Latitude Explorer preview" class="intro-screenshot">
        <p>Pick a city and see <strong>who shares your latitude</strong> around the globe. Discover what percentage of humanity lives <strong>north or south</strong> of you.</p>
        <button class="intro-start" id="intro-start">Explore</button>
      </div>
    </div>

    <!-- Data sources modal -->
    <div id="data-modal" class="modal hidden">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <button class="modal-close" aria-label="Close">&times;</button>
        <h2>Data Sources</h2>
        <ul>
          <li><strong>Cities & populations:</strong> GeoNames geographical database</li>
          <li><strong>Temperatures:</strong> WorldClim 2.1 bioclimatic variables (1970-2000 averages)</li>
          <li><strong>Population distribution:</strong> Derived from WorldPop/UN population data</li>
          <li><strong>Historical climate (comparison):</strong> Open-Meteo ERA5 reanalysis (1940–present)</li>
          <li><strong>Historical population (comparison):</strong> Wikidata population statements</li>
        </ul>
      </div>
    </div>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="js/population.js?v=<?= filemtime('js/population.js') ?>"></script>
  <script src="js/compare.js?v=<?= filemtime('js/compare.js') ?>"></script>
  <script src="js/app.js?v=<?= filemtime('js/app.js') ?>"></script>

</body>
</html>
