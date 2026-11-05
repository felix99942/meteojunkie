#!/usr/bin/env bash
# Lädt den Höhenspiegel aus scripts/topo-mirror.mjs nach R2 (Präfix topo/, ausgeliefert
# vom Worker). Einmalig von Hand, nicht im Deploy: das Relief ändert sich nicht.
#
# `copy` statt `sync`: löscht in R2 nichts. Aufruf: scripts/topo-upload.sh [verzeichnis]
# Umgebung: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail

SRC="${1:-.cache/topo}"
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

rclone copy "$SRC" r2:meteojunkie-daten/topo \
  --checksum --fast-list --transfers 32 --checkers 32 --stats-one-line --stats 60s
