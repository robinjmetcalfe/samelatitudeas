<?php
header('Content-Type: application/json');

// Only allow requests from same domain
$allowedHost = $_SERVER['HTTP_HOST'] ?? '';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$referer = $_SERVER['HTTP_REFERER'] ?? '';

// Check if request is from same origin
$isSameOrigin = false;
if ($origin) {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $isSameOrigin = ($originHost === $allowedHost);
} elseif ($referer) {
    $refererHost = parse_url($referer, PHP_URL_HOST);
    $isSameOrigin = ($refererHost === $allowedHost);
} else {
    // No Origin/Referer - allow if it's a same-origin request (browser doesn't send these for same-origin)
    // This allows direct browser navigation but blocks cross-origin fetch/XHR
    $isSameOrigin = true;
}

if (!$isSameOrigin) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

$dbFile = __DIR__ . '/../data/cities.db';

if (!file_exists($dbFile)) {
    http_response_code(500);
    echo json_encode(['error' => 'Database not found']);
    exit;
}

$db = new SQLite3($dbFile, SQLITE3_OPEN_READONLY);

$action = $_GET['action'] ?? '';

// Patterns to exclude administrative subdivisions (not actual cities)
$excludePatterns = [
    "name NOT LIKE '%city centre%'",
    "name NOT LIKE '%city center%'",
    "name NOT LIKE '%City Centre%'",
    "name NOT LIKE '%City Center%'",
    "name NOT LIKE '%business district%'",
    "name NOT LIKE '%Business District%'",
    "name NOT LIKE '%Residential District%'",
    "name NOT LIKE '%Administrative District%'",
];
$excludeClause = implode(' AND ', $excludePatterns);

switch ($action) {
    case 'search':
        // Search cities by name
        $query = $_GET['q'] ?? '';
        if (strlen($query) < 1) {
            echo json_encode([]);
            exit;
        }

        $stmt = $db->prepare("SELECT name, country, lat, lng, population, avg_temp, max_temp, min_temp FROM cities WHERE name LIKE ? AND $excludeClause ORDER BY population DESC LIMIT 15");
        $stmt->bindValue(1, $query . '%', SQLITE3_TEXT);
        $result = $stmt->execute();

        $cities = [];
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
            $cities[] = $row;
        }
        echo json_encode($cities);
        break;

    case 'latitude':
        // Get cities at a latitude band
        $lat = floatval($_GET['lat'] ?? 0);
        $tolerance = floatval($_GET['tolerance'] ?? 0.5);
        $minPop = intval($_GET['minPop'] ?? 50000);

        $stmt = $db->prepare("SELECT name, country, lat, lng, population, avg_temp, max_temp, min_temp FROM cities WHERE lat BETWEEN ? AND ? AND population >= ? AND $excludeClause ORDER BY population DESC LIMIT 300");
        $stmt->bindValue(1, $lat - $tolerance, SQLITE3_FLOAT);
        $stmt->bindValue(2, $lat + $tolerance, SQLITE3_FLOAT);
        $stmt->bindValue(3, $minPop, SQLITE3_INTEGER);
        $result = $stmt->execute();

        $cities = [];
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
            $cities[] = $row;
        }
        echo json_encode($cities);
        break;

    case 'stats':
        // Get population stats
        $result = $db->query('SELECT MIN(population) as min_pop, MAX(population) as max_pop FROM cities');
        $row = $result->fetchArray(SQLITE3_ASSOC);
        echo json_encode($row);
        break;

    default:
        echo json_encode(['error' => 'Invalid action']);
}

$db->close();
