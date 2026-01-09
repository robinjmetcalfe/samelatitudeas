<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$dbFile = __DIR__ . '/../data/cities.db';

if (!file_exists($dbFile)) {
    http_response_code(500);
    echo json_encode(['error' => 'Database not found']);
    exit;
}

$db = new SQLite3($dbFile, SQLITE3_OPEN_READONLY);

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'search':
        // Search cities by name
        $query = $_GET['q'] ?? '';
        if (strlen($query) < 1) {
            echo json_encode([]);
            exit;
        }

        $stmt = $db->prepare('SELECT name, country, lat, lng, population FROM cities WHERE name LIKE ? ORDER BY population DESC LIMIT 15');
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

        $stmt = $db->prepare('SELECT name, country, lat, lng, population FROM cities WHERE lat BETWEEN ? AND ? AND population >= ? ORDER BY population DESC LIMIT 150');
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
