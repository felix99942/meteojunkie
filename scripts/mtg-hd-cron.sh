#!/usr/bin/env bash
# Ein MTG-HD-Lauf für den systemd-Timer (scripts/systemd/mtg-hd.*): neue Termine
# holen und rechnen (scripts/mtg-hd-ingest.py), dann nach R2. Läuft auf dem Laptop,
# nicht im Deploy — ~250 MB Download und ~45 s Rechnen je 10-Minuten-Termin.
#
# Zugangsdaten:
#   ~/.config/meteojunkie/eumetsat.env   CONSUMER_KEY, CONSUMER_SECRET (Data Store)
#   ~/.config/meteojunkie/varda.env      R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
#                                        CLOUDFLARE_ACCOUNT_ID (derselbe R2-Zugang)
# Fehlen die R2-Angaben, wird nur gerechnet (lokal sichtbar über `npm run dev`).
set -euo pipefail

cd "$(dirname "$0")/.."
MTG_HOME="${MTG_HOME:-$HOME/mtg-hd}"
WORK="${MTG_WORK:-/var/tmp/mtg-hd}"
OUT="$WORK/out"
mkdir -p "$WORK"

# Läuft der vorige Lauf noch (Nachholen nach dem Aufwachen), diesen auslassen
exec 9>"$WORK/lock"
flock -n 9 || { echo "voriger Lauf läuft noch"; exit 0; }

ENV_FILE="${VARDA_ENV:-$HOME/.config/meteojunkie/varda.env}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

# Ohne Netz kein Lauf (dieselbe Prüfung wie varda-cron.sh: nm-online meldet nach
# dem Aufwachen den alten Zustand)
net_ok() { curl -sfI --max-time 10 -o /dev/null https://api.eumetsat.int/; }
for _ in $(seq 30); do net_ok && break; sleep 10; done
net_ok || { echo "kein Netz — kein Lauf"; exit 0; }

# FCI-Dateien sind mit FCIDECOMP gepackt; das Plugin kommt aus hdf5plugin
HDF5_PLUGIN_PATH="$("$MTG_HOME/.venv/bin/python" -c 'import hdf5plugin; print(hdf5plugin.PLUGINS_PATH)')"
export HDF5_PLUGIN_PATH MTG_WORK="$WORK"

"$MTG_HOME/.venv/bin/python" -I scripts/mtg-hd-ingest.py

# Für `npm run dev`: der Vorrat liegt in /var/tmp (/home ist knapp), Vite sieht ihn
# über Verweise unter denselben Pfaden wie auf der Seite
mkdir -p public/sat public/sat-tiles
[[ -e public/sat/mtghd ]] || ln -s "$OUT/sat/mtghd" public/sat/mtghd
[[ -e public/sat-tiles/mtghd ]] || ln -s "$OUT/sattile/mtghd" public/sat-tiles/mtghd

# Lokal aufräumen: was älter als 26 h ist, braucht die Ziehleiste nicht mehr
find "$OUT/sat/mtghd" -name '*.jpg' -mmin +1560 -delete 2>/dev/null || true
find "$OUT/sattile/mtghd" -mindepth 1 -maxdepth 1 -type d -mmin +1560 -exec rm -rf {} + 2>/dev/null || true

[[ -s "$WORK/new.txt" ]] || exit 0
# Vorerst nur lokal (auf Wunsch, 2026-11-10): ohne MTG_UPLOAD=1 kein Upload nach R2,
# das Produkt steht auch nur im Dev-Server in der Auswahl (OWN_PRODUCTS_VISIBLE)
if [[ "${MTG_UPLOAD:-0}" != 1 ]]; then
  echo "nur lokal (MTG_UPLOAD nicht gesetzt): $(tr '\n' ' ' < "$WORK/new.txt")"
  exit 0
fi
if [[ -z "${R2_ACCESS_KEY_ID:-}" ]]; then
  echo "keine R2-Zugangsdaten in $ENV_FILE — nur lokal abgelegt"
  exit 0
fi

export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
BUCKET="${R2_TARGET:-r2:meteojunkie-daten}"
OPTS=(--checksum --transfers 16 --checkers 16 --stats-one-line --stats 30s)

# Erst die Bilder, dann die meta.json, die auf sie verweist — umgekehrt holte ein
# Browser in der Lücke Termine, die es noch nicht gibt (wie upload-data.sh)
while read -r s; do
  rclone copy "$OUT/sattile/mtghd/$s" "$BUCKET/sattile/mtghd/$s" "${OPTS[@]}"
  for tier in hi lo; do
    rclone copyto "$OUT/sat/mtghd/$tier/$s.jpg" "$BUCKET/sat/mtghd/$tier/$s.jpg" "${OPTS[@]}"
  done
done < "$WORK/new.txt"
rclone copyto "$OUT/sat/mtghd/meta.json" "$BUCKET/sat/mtghd/meta.json" "${OPTS[@]}"
# Alte Europabilder in R2 weg; sattile/ räumt die Lifecycle-Regel des Buckets
rclone delete "$BUCKET/sat/mtghd" --min-age 26h --include '*.jpg' "${OPTS[@]}" || true
echo "hochgeladen: $(tr '\n' ' ' < "$WORK/new.txt")"
