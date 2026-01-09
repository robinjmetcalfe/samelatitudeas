<?php
// Build SQLite database from GeoNames data
// Format: geonameid, name, asciiname, alternatenames, lat, lng, feature_class, feature_code, country_code, ...population (col 14)

$geoFile = '/tmp/cities5000.txt';
$dbFile = __DIR__ . '/data/cities.db';

// Country codes to names (hardcoded common ones for speed)
$countryMap = [
    'US' => 'United States', 'GB' => 'United Kingdom', 'CA' => 'Canada', 'AU' => 'Australia',
    'DE' => 'Germany', 'FR' => 'France', 'IT' => 'Italy', 'ES' => 'Spain', 'JP' => 'Japan',
    'CN' => 'China', 'IN' => 'India', 'BR' => 'Brazil', 'RU' => 'Russia', 'MX' => 'Mexico',
    'KR' => 'South Korea', 'ID' => 'Indonesia', 'NL' => 'Netherlands', 'TR' => 'Turkey',
    'SA' => 'Saudi Arabia', 'CH' => 'Switzerland', 'PL' => 'Poland', 'SE' => 'Sweden',
    'BE' => 'Belgium', 'TH' => 'Thailand', 'AT' => 'Austria', 'NO' => 'Norway', 'AE' => 'UAE',
    'IL' => 'Israel', 'IE' => 'Ireland', 'DK' => 'Denmark', 'SG' => 'Singapore', 'MY' => 'Malaysia',
    'PH' => 'Philippines', 'ZA' => 'South Africa', 'AR' => 'Argentina', 'CL' => 'Chile',
    'CO' => 'Colombia', 'EG' => 'Egypt', 'PK' => 'Pakistan', 'BD' => 'Bangladesh', 'NG' => 'Nigeria',
    'VN' => 'Vietnam', 'NZ' => 'New Zealand', 'FI' => 'Finland', 'PT' => 'Portugal', 'CZ' => 'Czechia',
    'GR' => 'Greece', 'RO' => 'Romania', 'HU' => 'Hungary', 'UA' => 'Ukraine', 'PE' => 'Peru',
    'VE' => 'Venezuela', 'IR' => 'Iran', 'IQ' => 'Iraq', 'KW' => 'Kuwait', 'QA' => 'Qatar',
];

// Remove existing database
if (file_exists($dbFile)) {
    unlink($dbFile);
}

$db = new SQLite3($dbFile);
$db->exec('PRAGMA journal_mode = OFF');
$db->exec('PRAGMA synchronous = OFF');

// Create table
$db->exec('CREATE TABLE cities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    population INTEGER NOT NULL
)');

// Import GeoNames (tab-separated)
$handle = fopen($geoFile, 'r');

$db->exec('BEGIN TRANSACTION');

$stmt = $db->prepare('INSERT INTO cities (name, country, lat, lng, population) VALUES (?, ?, ?, ?, ?)');

$count = 0;
while (($line = fgets($handle)) !== false) {
    $row = explode("\t", $line);
    if (count($row) >= 15) {
        $name = trim($row[1]);
        $countryCode = trim($row[8]);
        $country = $countryMap[$countryCode] ?? $countryCode;
        $lat = floatval($row[4]);
        $lng = floatval($row[5]);
        $pop = intval($row[14]);

        if ($pop >= 1000 && !empty($name)) {
            $stmt->bindValue(1, $name, SQLITE3_TEXT);
            $stmt->bindValue(2, $country, SQLITE3_TEXT);
            $stmt->bindValue(3, $lat, SQLITE3_FLOAT);
            $stmt->bindValue(4, $lng, SQLITE3_FLOAT);
            $stmt->bindValue(5, $pop, SQLITE3_INTEGER);
            $stmt->execute();
            $stmt->reset();
            $count++;

            if ($count % 10000 == 0) {
                $db->exec('COMMIT');
                $db->exec('BEGIN TRANSACTION');
                echo "Imported $count...\n";
            }
        }
    }
}

$db->exec('COMMIT');

// Create indexes after import
$db->exec('CREATE INDEX idx_lat ON cities(lat)');
$db->exec('CREATE INDEX idx_pop ON cities(population)');

fclose($handle);
$db->close();

echo "Imported $count cities\n";
