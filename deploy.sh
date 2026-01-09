#!/bin/bash
SERVER="solarise-deploy"

# Sync public files
rsync -avz --exclude '.git' --exclude 'deploy.sh' --exclude 'data' ./public/ $SERVER:/var/www/html/sol-nov-25/samelatitudeas/

# Sync database to safe location
ssh $SERVER "mkdir -p /var/www/data"
rsync -avz ./data/cities.db $SERVER:/var/www/data/
