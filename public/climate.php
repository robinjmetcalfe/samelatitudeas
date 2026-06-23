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

// Astronomical daylight hours for a latitude on a given day-of-year.
function daylightHours($lat, $doy) {
    $phi = deg2rad($lat);
    $decl = deg2rad(23.44 * sin(deg2rad(360.0 / 365.0 * ($doy - 81))));
    $x = -tan($phi) * tan($decl);
    if ($x <= -1) return 24.0;
    if ($x >= 1) return 0.0;
    return 2 * rad2deg(acos($x)) / 15.0;
}

// Köppen-Geiger classification from 12 monthly mean temps (°C) and
// monthly precipitation (mm/month). Returns [code, name].
function koppen($T, $P, $lat) {
    $n = 12;
    $Tann = array_sum($T) / $n;
    $Pann = array_sum($P);
    $Tmax = max($T); $Tmin = min($T);
    $Pmin = min($P);
    // Hemisphere summer half-year (high-sun): N = Apr-Sep (idx 3..8), S = Oct-Mar
    $north = $lat >= 0;
    $summerIdx = $north ? [3,4,5,6,7,8] : [9,10,11,0,1,2];
    $winterIdx = $north ? [9,10,11,0,1,2] : [3,4,5,6,7,8];
    $Psummer = array_map(fn($i) => $P[$i], $summerIdx);
    $Pwinter = array_map(fn($i) => $P[$i], $winterIdx);
    $sumSummer = array_sum($Psummer);
    $sumWinter = array_sum($Pwinter);

    // Aridity threshold
    if ($sumWinter >= 0.7 * $Pann) $Pth = 2 * $Tann;
    elseif ($sumSummer >= 0.7 * $Pann) $Pth = 2 * $Tann + 28;
    else $Pth = 2 * $Tann + 14;

    $code = '';
    if ($Pann < 10 * $Pth) {
        // B - arid
        $code = 'B' . ($Pann < 5 * $Pth ? 'W' : 'S') . ($Tann >= 18 ? 'h' : 'k');
    } elseif ($Tmin >= 18) {
        // A - tropical
        if ($Pmin >= 60) $code = 'Af';
        elseif ($Pmin >= 100 - $Pann / 25) $code = 'Am';
        else $code = 'Aw';
    } elseif ($Tmax >= 10 && $Tmin >= 0) {
        // C - temperate
        $code = 'C' . cdPrecip($Psummer, $Pwinter) . cdTemp($T, $Tmax);
    } elseif ($Tmax >= 10 && $Tmin < 0) {
        // D - continental
        $code = 'D' . cdPrecip($Psummer, $Pwinter) . cdTemp($T, $Tmax);
    } else {
        // E - polar
        $code = $Tmax >= 0 ? 'ET' : 'EF';
    }
    return [$code, koppenName($code)];
}
function cdPrecip($Ps, $Pw) {
    $PsMin = min($Ps); $PsMax = max($Ps);
    $PwMin = min($Pw); $PwMax = max($Pw);
    if ($PsMin < 40 && $PsMin < $PwMax / 3) return 's';   // dry summer
    if ($PwMin < $PsMax / 10) return 'w';                  // dry winter
    return 'f';
}
function cdTemp($T, $Tmax) {
    $warm = count(array_filter($T, fn($t) => $t >= 10));
    if ($Tmax >= 22) return 'a';
    if ($warm >= 4) return 'b';
    if (min($T) < -38) return 'd';
    return 'c';
}
function koppenName($c) {
    $map = [
        'Af' => 'Tropical rainforest', 'Am' => 'Tropical monsoon',
        'Aw' => 'Tropical savanna', 'As' => 'Tropical savanna',
        'BWh' => 'Hot desert', 'BWk' => 'Cold desert',
        'BSh' => 'Hot semi-arid', 'BSk' => 'Cold semi-arid',
        'Cfa' => 'Humid subtropical', 'Cfb' => 'Oceanic', 'Cfc' => 'Subpolar oceanic',
        'Cwa' => 'Humid subtropical (dry winter)', 'Cwb' => 'Subtropical highland', 'Cwc' => 'Cold subtropical highland',
        'Csa' => 'Hot-summer Mediterranean', 'Csb' => 'Warm-summer Mediterranean', 'Csc' => 'Cold Mediterranean',
        'Dfa' => 'Hot-summer humid continental', 'Dfb' => 'Warm-summer humid continental',
        'Dfc' => 'Subarctic', 'Dfd' => 'Extremely cold subarctic',
        'Dwa' => 'Humid continental (dry winter)', 'Dwb' => 'Humid continental (dry winter)',
        'Dwc' => 'Subarctic (dry winter)', 'Dwd' => 'Extremely cold subarctic',
        'Dsa' => 'Mediterranean continental', 'Dsb' => 'Mediterranean continental',
        'Dsc' => 'Cold Mediterranean continental', 'Dsd' => 'Extremely cold continental',
        'ET' => 'Tundra', 'EF' => 'Ice cap',
    ];
    return $map[$c] ?? $c;
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

// ---- Meteostat: measured station sunshine duration -----------------------
function fetchGz($url, $timeout = 30) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'samelatitudeas/1.0 (https://samelatitudeas.solarise.dev)',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $code !== 200) return null;
    $dec = @gzdecode($body);
    return $dec !== false ? $dec : $body;
}

function haversineKm($la1, $lo1, $la2, $lo2) {
    $R = 6371;
    $dLa = deg2rad($la2 - $la1); $dLo = deg2rad($lo2 - $lo1);
    $a = sin($dLa / 2) ** 2 + cos(deg2rad($la1)) * cos(deg2rad($la2)) * sin($dLo / 2) ** 2;
    return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

// Populate the met_stations table from Meteostat's station list (once).
function ensureMetStations() {
    $db = cacheDb();
    $db->exec('CREATE TABLE IF NOT EXISTS met_stations (id TEXT PRIMARY KEY, lat REAL, lng REAL, name TEXT)');
    $count = (int)$db->querySingle('SELECT COUNT(*) FROM met_stations');
    if ($count > 0) return true;
    $raw = fetchGz('https://bulk.meteostat.net/v2/stations/lite.json.gz', 45);
    if ($raw === null) return false;
    $arr = json_decode($raw, true);
    if (!is_array($arr)) return false;
    $db->exec('BEGIN');
    $stmt = $db->prepare('INSERT OR IGNORE INTO met_stations (id,lat,lng,name) VALUES (?,?,?,?)');
    foreach ($arr as $s) {
        $loc = $s['location'] ?? null;
        if (!$loc || !isset($loc['latitude'], $loc['longitude'])) continue;
        $norm = $s['inventory']['normals'] ?? null;   // only stations that have normals
        if (!$norm || empty($norm['start'])) continue;
        $name = is_array($s['name'] ?? null) ? ($s['name']['en'] ?? $s['id']) : ($s['name'] ?? $s['id']);
        $stmt->bindValue(1, $s['id'], SQLITE3_TEXT);
        $stmt->bindValue(2, (float)$loc['latitude'], SQLITE3_FLOAT);
        $stmt->bindValue(3, (float)$loc['longitude'], SQLITE3_FLOAT);
        $stmt->bindValue(4, $name, SQLITE3_TEXT);
        $stmt->execute();
        $stmt->reset();
    }
    $db->exec('COMMIT');
    return true;
}

// Parse one station's bulk normals -> [period => [month => tsun_minutes|null]]
function stationNormals($id) {
    $cached = cacheGet("metnorm:$id", 60 * 60 * 24 * 120);
    if ($cached !== null) { $d = json_decode($cached, true); return is_array($d) ? $d : null; }
    $raw = fetchGz("https://bulk.meteostat.net/v2/normals/$id.csv.gz", 20);
    $out = [];
    if ($raw !== null) {
        foreach (explode("\n", trim($raw)) as $line) {
            $c = explode(',', $line);
            if (count($c) < 9) continue;
            $month = (int)$c[2];
            if ($month < 1 || $month > 12) continue;
            $tsun = $c[8];
            $out[$c[0] . '-' . $c[1]][$month] = ($tsun === '' || $tsun === 'None') ? null : (float)$tsun;
        }
    }
    cacheSet("metnorm:$id", json_encode($out));
    return $out ?: null;
}

// Nearest station with measured sunshine normals; returns monthly hours + meta.
function measuredSunshine($lat, $lng) {
    if (!ensureMetStations()) return null;
    $db = cacheDb();
    $dLat = 3.0;
    $dLng = 3.0 / max(0.2, cos(deg2rad($lat)));
    $stmt = $db->prepare('SELECT id,lat,lng,name FROM met_stations WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?');
    $stmt->bindValue(1, $lat - $dLat, SQLITE3_FLOAT); $stmt->bindValue(2, $lat + $dLat, SQLITE3_FLOAT);
    $stmt->bindValue(3, $lng - $dLng, SQLITE3_FLOAT); $stmt->bindValue(4, $lng + $dLng, SQLITE3_FLOAT);
    $res = $stmt->execute();
    $cands = [];
    while ($r = $res->fetchArray(SQLITE3_ASSOC)) {
        $d = haversineKm($lat, $lng, $r['lat'], $r['lng']);
        if ($d <= 300) { $r['dist'] = $d; $cands[] = $r; }
    }
    usort($cands, fn($a, $b) => $a['dist'] <=> $b['dist']);
    $cands = array_slice($cands, 0, 15);
    foreach ($cands as $c) {
        $norm = stationNormals($c['id']);
        if ($norm === null) continue;
        $best = null; $bestPeriod = null;
        foreach (['1991-2020', '1981-2010', '1971-2000', '1961-1990'] as $pk) {
            if (isset($norm[$pk]) && count(array_filter($norm[$pk], fn($v) => $v !== null)) >= 10) {
                $best = $norm[$pk]; $bestPeriod = $pk; break;
            }
        }
        if ($best === null) continue;
        $monthly = []; $annual = 0; $ok = 0;
        for ($m = 1; $m <= 12; $m++) {
            $v = $best[$m] ?? null;
            if ($v === null) { $monthly[$m] = null; }
            else { $h = $v / 60; $monthly[$m] = round($h); $annual += $h; $ok++; }
        }
        if ($ok < 10) continue;
        return [
            'monthly' => $monthly, 'annual' => round($annual),
            'station' => $c['name'], 'dist' => round($c['dist']),
            'period' => str_replace('-', '–', $bestPeriod),
        ];
    }
    return null;
}

// ---- GHS-UCDB: urban-centre population at 1975/1990/2000/2015 -------------
function ghsPopDb() {
    static $db = false;
    if ($db !== false) return $db;
    $db = null;
    foreach (['/var/www/data/ghs-pop.db', __DIR__ . '/../data/ghs-pop.db'] as $c) {
        if (file_exists($c)) { $db = new SQLite3($c, SQLITE3_OPEN_READONLY); break; }
    }
    return $db;
}
function nearestGhsCentre($lat, $lng, $maxKm = 35) {
    $db = ghsPopDb();
    if (!$db) return null;
    $dLat = 0.5; $dLng = 0.5 / max(0.2, cos(deg2rad($lat)));
    $stmt = $db->prepare('SELECT lat,lng,name,country,p75,p90,p00,p15 FROM centres WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?');
    $stmt->bindValue(1, $lat - $dLat, SQLITE3_FLOAT); $stmt->bindValue(2, $lat + $dLat, SQLITE3_FLOAT);
    $stmt->bindValue(3, $lng - $dLng, SQLITE3_FLOAT); $stmt->bindValue(4, $lng + $dLng, SQLITE3_FLOAT);
    $res = $stmt->execute();
    $best = null; $bestD = $maxKm;
    while ($r = $res->fetchArray(SQLITE3_ASSOC)) {
        $d = haversineKm($lat, $lng, $r['lat'], $r['lng']);
        if ($d <= $bestD) { $bestD = $d; $best = $r; $best['dist'] = $d; }
    }
    return $best;
}

$action = $_GET['action'] ?? '';

if ($action === 'climate') {
    $lat = round(floatval($_GET['lat'] ?? 0), 2);
    $lng = round(floatval($_GET['lng'] ?? 0), 2);
    $key = "climate:v3:$lat:$lng";

    $cached = cacheGet($key, 60 * 60 * 24 * 90); // 90-day TTL
    if ($cached !== null) { echo $cached; exit; }

    // NASA POWER monthly climatology (~1981-present). Light, server-side
    // monthly aggregation, no rate limits. Month "13" is an annual value but
    // its meaning differs per parameter, so we aggregate the 12 months ourselves.
    $startYear = 1981;
    $endYear = (int)date('Y') - 1; // last full year (POWER has no future/partial-year data)
    $params = 'T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,TOA_SW_DWN,WS10M,RH2M';
    $url = 'https://power.larc.nasa.gov/api/temporal/monthly/point'
         . "?parameters=$params&community=RE"
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

    $T2M = $param['T2M']; $TMX = $param['T2M_MAX']; $TMN = $param['T2M_MIN'];
    $PR = $param['PRECTOTCORR'];
    $SW = $param['ALLSKY_SFC_SW_DWN'] ?? []; $TOA = $param['TOA_SW_DWN'] ?? [];
    $WS = $param['WS10M'] ?? []; $RH = $param['RH2M'] ?? [];
    $daysInMonth = [1=>31,2=>28,3=>31,4=>30,5=>31,6=>30,7=>31,8=>31,9=>30,10=>31,11=>30,12=>31];
    $midDoy = [1=>15,2=>46,3=>74,4=>105,5=>135,6=>166,7=>196,8=>227,9=>258,10=>288,11=>319,12=>349];
    $ok = fn($v) => $v !== null && $v > -990;

    // Collect available years
    $yearSet = [];
    foreach ($T2M as $k => $v) { $yearSet[substr($k, 0, 4)] = true; }
    $years = array_keys($yearSet);
    sort($years);

    // Per-year series + per-calendar-month accumulators (for normals)
    $series = [];
    $seasonAmps = [];
    $mAcc = [];
    for ($m = 1; $m <= 12; $m++) $mAcc[$m] = ['t'=>0,'tx'=>0,'tn'=>0,'p'=>0,'sw'=>0,'toa'=>0,'n'=>0];

    foreach ($years as $y) {
        $highs = []; $lows = []; $means = []; $precip = 0;
        $swv = []; $wsv = []; $rhv = []; $complete = true;
        for ($m = 1; $m <= 12; $m++) {
            $mk = $y . sprintf('%02d', $m);
            $hi = $TMX[$mk] ?? -999; $lo = $TMN[$mk] ?? -999; $me = $T2M[$mk] ?? -999;
            $pr = $PR[$mk] ?? -999; $sw = $SW[$mk] ?? -999; $toa = $TOA[$mk] ?? -999;
            $ws = $WS[$mk] ?? -999; $rh = $RH[$mk] ?? -999;
            if (!$ok($hi) || !$ok($lo) || !$ok($me)) { $complete = false; break; }
            $highs[] = $hi; $lows[] = $lo; $means[] = $me;
            if ($ok($pr)) $precip += $pr * $daysInMonth[$m];
            if ($ok($sw)) $swv[] = $sw;
            if ($ok($ws)) $wsv[] = $ws;
            if ($ok($rh)) $rhv[] = $rh;
            // accumulate monthly normals
            $a = &$mAcc[$m];
            $a['t'] += $me; $a['tx'] += $hi; $a['tn'] += $lo;
            if ($ok($pr)) $a['p'] += $pr * $daysInMonth[$m];
            if ($ok($sw)) $a['sw'] += $sw;
            if ($ok($toa)) $a['toa'] += $toa;
            $a['n']++;
            unset($a);
        }
        if (!$complete || count($means) < 12) continue;
        $series[] = [
            'year' => (int)$y,
            'tmax' => round(array_sum($highs) / 12, 1),
            'tmin' => round(array_sum($lows) / 12, 1),
            'tmean' => round(array_sum($means) / 12, 1),
            'precip' => round($precip),
            'solar' => count($swv) ? round(array_sum($swv) / count($swv), 2) : null,
            'wind' => count($wsv) ? round(array_sum($wsv) / count($wsv), 1) : null,
            'humidity' => count($rhv) ? round(array_sum($rhv) / count($rhv)) : null,
        ];
        $seasonAmps[] = max($means) - min($means);
    }

    if (count($series) < 5) {
        http_response_code(502);
        echo json_encode(['error' => 'Insufficient data']);
        exit;
    }

    // Monthly normals + estimated sunshine hours (Ångström-Prescott via clearness index)
    $monthly = [];
    $monT = []; $monP = [];
    $annualSun = 0;
    for ($m = 1; $m <= 12; $m++) {
        $a = $mAcc[$m];
        if ($a['n'] === 0) continue;
        $tmean = $a['t'] / $a['n'];
        $precipM = $a['p'] / $a['n'];
        $sw = $a['sw'] / $a['n']; $toa = $a['toa'] / $a['n'];
        $daylen = daylightHours($lat, $midDoy[$m]);
        $sunFrac = ($toa > 0) ? max(0, min(1, ($sw / $toa - 0.25) / 0.5)) : 0;
        $sunHours = round($daylen * $sunFrac * $daysInMonth[$m]);
        $annualSun += $sunHours;
        $monthly[] = [
            'm' => $m,
            'tmean' => round($tmean, 1),
            'tmax' => round($a['tx'] / $a['n'], 1),
            'tmin' => round($a['tn'] / $a['n'], 1),
            'precip' => round($precipM),
            'solar' => round($sw, 2),
            'sun' => $sunHours,
            'daylight' => round($daylen, 1),
        ];
        $monT[] = $tmean; $monP[] = $precipM;
    }

    // Prefer MEASURED sunshine (nearest Meteostat station normals) over the estimate.
    $sunSource = 'estimated';
    $sunStation = null; $sunDist = null; $sunPeriod = null;
    $meas = measuredSunshine($lat, $lng);
    if ($meas !== null) {
        $sunSource = 'measured';
        $sunStation = $meas['station']; $sunDist = $meas['dist']; $sunPeriod = $meas['period'];
        $annualSun = $meas['annual'];
        foreach ($monthly as &$mm) {
            $mv = $meas['monthly'][$mm['m']] ?? null;
            if ($mv !== null) $mm['sun'] = $mv;
        }
        unset($mm);
    }

    $yArr = array_column($series, 'year');
    $warming = slopePerYear($yArr, array_column($series, 'tmean'));
    $seasonality = count($seasonAmps) ? array_sum($seasonAmps) / count($seasonAmps) : null;
    [$kCode, $kName] = (count($monT) === 12) ? koppen($monT, $monP, $lat) : [null, null];

    $out = [
        'source' => 'NASA POWER (monthly, ' . min($yArr) . '-' . max($yArr) . ')',
        'elevation' => $elevation,
        'lat' => $lat, 'lng' => $lng,
        'series' => $series,
        'monthly' => $monthly,
        'stats' => [
            'warming_per_decade' => $warming !== null ? round($warming * 10, 2) : null,
            'seasonality' => $seasonality !== null ? round($seasonality, 1) : null,
            'sunshine_annual' => $annualSun,
            'sunshine_source' => $sunSource,
            'sunshine_station' => $sunStation,
            'sunshine_dist' => $sunDist,
            'sunshine_period' => $sunPeriod,
            'koppen' => $kCode,
            'koppen_name' => $kName,
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
    $key = "pop:v2:$lat:$lng";

    $cached = cacheGet($key, 60 * 60 * 24 * 30); // 30-day TTL
    if ($cached !== null) { echo $cached; exit; }

    // 1) Prefer GHS-UCDB urban-centre series — consistent 1975/1990/2000/2015,
    //    global coverage for ~13k cities (far less sparse than Wikidata).
    $g = nearestGhsCentre($lat, $lng, 35);
    if ($g) {
        $points = [];
        foreach ([1975 => $g['p75'], 1990 => $g['p90'], 2000 => $g['p00'], 2015 => $g['p15']] as $yr => $v) {
            if ($v) $points[] = ['year' => $yr, 'value' => (int)$v];
        }
        if (count($points) >= 2) {
            $out = [
                'source' => 'GHS-UCDB urban centre (JRC)',
                'points' => $points,
                'centre' => $g['name'],
                'centre_dist' => round($g['dist']),
                'note' => null,
            ];
            $json = json_encode($out);
            cacheSet($key, $json);
            echo $json;
            exit;
        }
    }

    // 2) Fall back to Wikidata dated population statements (sparse, recent).
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
