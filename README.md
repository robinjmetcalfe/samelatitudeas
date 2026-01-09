# Latitude Explorer

A map tool that shows you which cities share your latitude. Search for a city, see a horizontal band across the globe, and discover what percentage of humanity lives north or south of you.

## Features

- Search for any city and see others at the same latitude
- Population statistics for each latitude band
- Temperature data (min/max) from WorldClim climate records
- Works across infinite world tile scrolling

## Tech

- Leaflet.js with CartoDB dark tiles
- Vanilla JavaScript (no framework)
- PHP + SQLite backend
- WorldClim 2.1 temperature data
- GeoNames city database

## Data Sources

- **Cities & populations**: GeoNames geographical database
- **Temperatures**: WorldClim 2.1 bioclimatic variables (1970-2000 averages)
- **Population distribution**: Derived from WorldPop/UN population data

## Setup

Requires PHP with SQLite3. Point a web server at the `public/` directory. The SQLite database should be in `data/cities.db`.

## License

MIT
