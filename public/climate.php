<?php
/**
 * Historical climate + population endpoint for the comparison feature.
 *
 * Pulls real data on demand (the comparison list is capped at 10 cities) and
 * caches the aggregated result in a small SQLite DB that lives in the project's
 * persistent shared/ dir, so it survives deploys and only ever fetches once
 * per location.
 *
 *   action=climate&lat=&lng=         -> annual temp/precip series (Open-Meteo ERA5, 1940-)
 *   action=population&lat=&lng=      -> dated population points (Wikidata, where available)
 */

header('Content-Type: application/json');

// --- Same-origin guard (mirrors api.php) ---------------------------------
$allowedHost = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$referer = $_SERVER['HTTP_REFERER'] ?? '';
$isSameOrigin = false;
if ($origin) {
    $isSameOrigin = (parse_url($origin, PHP_URL_HOST) === $allowedHost);
} elseif ($referer) {
    $isSameOrigin = (parse_url($referer, PHP_URL_HOST) === $allowedHost);
} else {
    $isSameOrigin = true;
}
if (!$isSameOrigin) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

// --- Cache DB (persistent across deploys) --------------------------------
function cacheDb() {
    static $db = null;
    if ($db !== null) return $db;
    $candidates = [
        '/srv/solarise/projects/samelatitudeas/shared/cache.db', // production
        __DIR__ . '/../data/cache.db',                            // local dev
    ];
    $path = null;
    foreach ($candidates as $c) {
        $dir = dirname($c);
        if (is_dir($dir) && is_writable($dir)) { $path = $c; break; }
        if (file_exists($c) && is_writable($c)) { $path = $c; break; }
    }
    if ($path === null) $path = __DIR__ . '/../data/cache.db';
    $db = new SQLite3($path);
    $db->busyTimeout(5000);
    $db->exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, data TEXT, ts INTEGER)');
    return $db;
}

function cacheGet($key, $maxAge = null) {
    $db = cacheDb();
    $stmt = $db->prepare('SELECT data, ts FROM kv WHERE k = ?');
    $stmt->bindValue(1, $key, SQLITE3_TEXT);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    if (!$row) return null;
    if ($maxAge !== null && (time() - (int)$row['ts']) > $maxAge) return null;
    return $row['data'];
}

function cacheSet($key, $data) {
    $db = cacheDb();
    $stmt = $db->prepare('INSERT OR REPLACE INTO kv (k, data, ts) VALUES (?, ?, ?)');
    $stmt->bindValue(1, $key, SQLITE3_TEXT);
    $stmt->bindValue(2, $data, SQLITE3_TEXT);
    $stmt->bindValue(3, time(), SQLITE3_INTEGER);
    $stmt->execute();
}

function httpGet($url, $timeout = 60) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'samelatitudeas/1.0 (https://samelatitudeas.solarise.dev)',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $code !== 200) return null;
    return $body;
}

// Linear regression slope (per year) of (x=years, y=values)
function slopePerYear($years, $values) {
    $n = count($years);
    if ($n < 5) return null;
    $sx = $sy = $sxx = $sxy = 0;
    for ($i = 0; $i < $n; $i++) {
        $sx += $years[$i]; $sy += $values[$i];
        $sxx += $years[$i] * $years[$i];
        $sxy += $years[$i] * $values[$i];
    }
    $denom = ($n * $sxx - $sx * $sx);
    if ($denom == 0) return null;
    return ($n * $sxy - $sx * $sy) / $denom;
}

$action = $_GET['action'] ?? '';

if ($action === 'climate') {
    $lat = round(floatval($_GET['lat'] ?? 0), 2);
    $lng = round(floatval($_GET['lng'] ?? 0), 2);
    $key = "climate:$lat:$lng";

    $cached = cacheGet($key, 60 * 60 * 24 * 90); // 90-day TTL
    if ($cached !== null) { echo $cached; exit; }

    // NASA POWER monthly climatology (~1981-present). Light, server-side
    // monthly aggregation, no rate limits. Month "13" is an annual value but
    // its meaning differs per parameter, so we aggregate the 12 months ourselves.
    $startYear = 1981;
    $endYear = (int)date('Y') - 1; // last full year (POWER has no future/partial-year data)
    $url = 'https://power.larc.nasa.gov/api/temporal/monthly/point'
         . "?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR&community=RE"
         . "&longitude=$lng&latitude=$lat&start=$startYear&end=$endYear&format=JSON";

    $raw = httpGet($url, 40);
    if ($raw === null) {
        http_response_code(502);
        echo json_encode(['error' => 'Climate source unavailable']);
        exit;
    }
    $d = json_decode($raw, true);
    $param = $d['properties']['parameter'] ?? null;
    if (!$param || !isset($param['T2M'])) {
        http_response_code(502);
        echo json_encode(['error' => 'No data']);
        exit;
    }
    $coords = $d['geometry']['coordinates'] ?? [];
    $elevation = isset($coords[2]) ? round($coords[2]) : null;

    $T2M = $param['T2M']; $TMX = $param['T2M_MAX'];
    $TMN = $param['T2M_MIN']; $PR = $param['PRECTOTCORR'];
    $daysInMonth = [1=>31,2=>28,3=>31,4=>30,5=>31,6=>30,7=>31,8=>31,9=>30,10=>31,11=>30,12=>31];

    // Collect available years from the monthly keys (YYYYMM)
    $yearSet = [];
    foreach ($T2M as $k => $v) { $yearSet[substr($k, 0, 4)] = true; }
    $years = array_keys($yearSet);
    sort($years);

    $series = [];
    $seasonAmps = [];
    foreach ($years as $y) {
        $highs = []; $lows = []; $means = []; $precip = 0; $complete = true;
        for ($m = 1; $m <= 12; $m++) {
            $mk = $y . sprintf('%02d', $m);
            $hi = $TMX[$mk] ?? -999; $lo = $TMN[$mk] ?? -999;
            $me = $T2M[$mk] ?? -999; $pr = $PR[$mk] ?? -999;
            if ($hi <= -990 || $lo <= -990 || $me <= -990) { $complete = false; break; }
            $highs[] = $hi; $lows[] = $lo; $means[] = $me;
            if ($pr > -990) $precip += $pr * $daysInMonth[$m];
        }
        if (!$complete || count($means) < 12) continue;
        $series[] = [
            'year' => (int)$y,
            'tmax' => round(array_sum($highs) / 12, 1),  // avg daily high
            'tmin' => round(array_sum($lows) / 12, 1),   // avg daily low
            'tmean' => round(array_sum($means) / 12, 1), // annual mean
            'precip' => round($precip),                  // annual mm
        ];
        $seasonAmps[] = max($means) - min($means);       // warmest - coldest month
    }

    if (count($series) < 5) {
        http_response_code(502);
        echo json_encode(['error' => 'Insufficient data']);
        exit;
    }

    $yArr = array_column($series, 'year');
    $meanArr = array_column($series, 'tmean');
    $warming = slopePerYear($yArr, $meanArr);
    $seasonality = count($seasonAmps) ? array_sum($seasonAmps) / count($seasonAmps) : null;

    $out = [
        'source' => 'NASA POWER (monthly, ' . min($yArr) . '-' . max($yArr) . ')',
        'elevation' => $elevation,
        'lat' => $lat, 'lng' => $lng,
        'series' => $series,
        'stats' => [
            'warming_per_decade' => $warming !== null ? round($warming * 10, 2) : null,
            'seasonality' => $seasonality !== null ? round($seasonality, 1) : null,
            'first_year' => min($yArr),
            'last_year' => max($yArr),
        ],
    ];
    $json = json_encode($out);
    cacheSet($key, $json);
    echo $json;
    exit;
}

if ($action === 'population') {
    $lat = round(floatval($_GET['lat'] ?? 0), 2);
    $lng = round(floatval($_GET['lng'] ?? 0), 2);
    $key = "pop:$lat:$lng";

    $cached = cacheGet($key, 60 * 60 * 24 * 30); // 30-day TTL
    if ($cached !== null) { echo $cached; exit; }

    // Find nearby settlements with population, plus any dated population statements.
    $sparql = 'SELECT ?city ?curpop ?dist ?pop ?date WHERE {'
        . ' SERVICE wikibase:around { ?city wdt:P625 ?loc.'
        . ' bd:serviceParam wikibase:center "Point(' . $lng . ' ' . $lat . ')"^^geo:wktLiteral.'
        . ' bd:serviceParam wikibase:radius "15". bd:serviceParam wikibase:distance ?dist. }'
        . ' ?city wdt:P1082 ?curpop.'
        . ' ?city p:P1082 ?st. ?st ps:P1082 ?pop. OPTIONAL { ?st pq:P585 ?date. }'
        . ' } ORDER BY ?dist LIMIT 400';
    $url = 'https://query.wikidata.org/sparql?format=json&query=' . rawurlencode($sparql);
    $raw = httpGet($url, 30);

    $out = ['source' => 'Wikidata (P1082 population statements)', 'points' => [], 'note' => null];
    if ($raw !== null) {
        $d = json_decode($raw, true);
        $bindings = $d['results']['bindings'] ?? [];
        // Pick the single best entity: largest current population among the nearest few.
        $byCity = [];
        foreach ($bindings as $b) {
            $cid = $b['city']['value'];
            if (!isset($byCity[$cid])) {
                $byCity[$cid] = [
                    'curpop' => (float)($b['curpop']['value'] ?? 0),
                    'dist' => (float)($b['dist']['value'] ?? 999),
                    'points' => [],
                ];
            }
            if (isset($b['date'])) {
                $year = (int)substr($b['date']['value'], 0, 4);
                $byCity[$cid]['points'][$year] = (float)$b['pop']['value'];
            }
        }
        // Choose entity: closest within 15km that has the most dated points, tie-break by curpop.
        $best = null; $bestCid = null;
        foreach ($byCity as $cid => $info) {
            if ($best === null
                || count($info['points']) > count($best['points'])
                || (count($info['points']) === count($best['points']) && $info['curpop'] > $best['curpop'])) {
                $best = $info; $bestCid = $cid;
            }
        }
        if ($best) {
            $pts = $best['points'];
            ksort($pts);
            foreach ($pts as $year => $val) {
                $out['points'][] = ['year' => $year, 'value' => (int)$val];
            }
            $out['wikidata'] = $bestCid;
            $out['current'] = (int)$best['curpop'];
            if (count($out['points']) < 2) {
                $out['note'] = 'Sparse historical data for this place.';
            }
        } else {
            $out['note'] = 'No population history found for this location.';
        }
    } else {
        $out['note'] = 'Population source unavailable.';
    }

    $json = json_encode($out);
    cacheSet($key, $json);
    echo $json;
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Invalid action']);
