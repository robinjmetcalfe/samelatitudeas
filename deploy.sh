#!/bin/bash

# Sync public files
rsync -avz --exclude '.git' --exclude 'deploy.sh' --exclude 'data' ./public/ solarise:/var/www/html/sol-nov-25/

# Sync database to safe location
ssh solarise "mkdir -p /var/www/data"
rsync -avz ./data/cities.db solarise:/var/www/data/
