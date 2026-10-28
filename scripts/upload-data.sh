#!/usr/bin/env bash
# Lädt die im Deploy erzeugten Daten nach Cloudflare R2 (Bucket
# meteojunkie-daten), wo sie der Worker unter denselben Pfaden ausliefert
# (worker/index.ts). Aufruf mit den Verzeichnissen unter public/, die
# übernommen werden sollen, z. B.:
#
#   scripts/upload-data.sh nwp/ecmwf-ifs nwp/icon-d2 de mos/forecast sondes
#
# WELCHE Verzeichnisse, entscheidet der Workflow am Erfolg des jeweiligen
# Ingests — dieses Skript SYNCHRONISIERT, löscht in R2 also, was lokal fehlt.
# Ein halb geschriebenes Verzeichnis nach einem gescheiterten Ingest würde
# sonst den letzten guten Stand in R2 wegräumen; auf GitHub Pages war das
# gleichgültig, weil dort ohnehin jeder Deploy alles ersetzte.
#
# `--checksum`: R2 führt bei einteiligen Uploads die MD5 als ETag, rclone
# lädt also nur, was sich wirklich geändert hat. Die Dateizeit taugt dafür
# nicht — auf dem Runner ist jede Datei frisch erzeugt bzw. aus dem Cache
# entpackt. Schreibvorgänge sind das knappe Freikontingent von R2
# (1 Mio./Monat), und ein unveränderter Lauf soll keinen einzigen kosten.
#
# Umgebung: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail

# Fehlende Zugangsdaten beim NAMEN nennen — ein nicht gesetztes GitHub-Secret
# kommt als LEERER String an, und rclone meldete dann nur „access denied"
missing=0
for v in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID; do
  [[ -n "${!v:-}" ]] || { echo "::error::$v ist leer — Secret bzw. Variable in GitHub prüfen"; missing=1; }
done
(( missing == 0 )) || exit 1

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
# R2_TARGET übersteuert das Ziel (lokaler Test gegen ein Verzeichnis)
BUCKET="${R2_TARGET:-r2:meteojunkie-daten}"
OPTS=(--checksum --fast-list --transfers 32 --checkers 32 --stats-one-line --stats 30s)

for dir in "$@"; do
  src="public/$dir"
  if [[ ! -d "$src" ]] || [[ -z "$(ls -A "$src")" ]]; then
    echo "· $dir: lokal leer — übersprungen, R2 behält den letzten Stand"
    continue
  fi
  echo "· $dir"
  # Erst alles AUSSER den Einstiegsdateien, dann der Rest samt Löschen: die
  # meta.json eines Modells verweist auf den neuen Lauf, und sie darf erst
  # dastehen, wenn dessen Bilder schon oben sind — umgekehrt holte ein
  # Browser in der Lücke Kacheln, die es noch nicht gibt.
  rclone copy "$src" "$BUCKET/$dir" "${OPTS[@]}" --exclude 'meta.json' --exclude 'index.json'
  rclone sync "$src" "$BUCKET/$dir" "${OPTS[@]}"
done
