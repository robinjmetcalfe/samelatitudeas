#!/bin/bash
SERVER="solarise-deploy"

# Sync public files (--delete removes files not in source)
rsync -avz --delete --exclude '.git' --exclude 'deploy.sh' --exclude 'data' ./public/ $SERVER:/var/www/html/sol-nov-25/samelatitudeas/

# Sync database to safe location
ssh $SERVER "mkdir -p /var/www/data"
rsync -avz ./data/cities.db $SERVER:/var/www/data/
