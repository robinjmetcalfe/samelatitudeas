<?php
// Build SQLite database from CSV

$csvFile = '/tmp/worldcities.csv';
$dbFile = __DIR__ . '/data/cities.db';

// Remove existing database
if (file_exists($dbFile)) {
    unlink($dbFile);
}

$db = new SQLite3($dbFile);

// Create table
$db->exec('CREATE TABLE cities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    population INTEGER NOT NULL
)');

// Create index for latitude queries
$db->exec('CREATE INDEX idx_lat ON cities(lat)');

// Import CSV
$handle = fopen($csvFile, 'r');
$header = fgetcsv($handle); // Skip header

$stmt = $db->prepare('INSERT INTO cities (name, country, lat, lng, population) VALUES (?, ?, ?, ?, ?)');

$count = 0;
while (($row = fgetcsv($handle)) !== false) {
    if (count($row) >= 5) {
        $stmt->bindValue(1, $row[0], SQLITE3_TEXT);
        $stmt->bindValue(2, $row[3], SQLITE3_TEXT);
        $stmt->bindValue(3, floatval($row[1]), SQLITE3_FLOAT);
        $stmt->bindValue(4, floatval($row[2]), SQLITE3_FLOAT);
        $stmt->bindValue(5, intval($row[4]), SQLITE3_INTEGER);
        $stmt->execute();
        $stmt->reset();
        $count++;
    }
}

fclose($handle);
$db->close();

echo "Imported $count cities\n";
