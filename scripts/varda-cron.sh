#!/usr/bin/env bash
# Ein Varda-Lauf für den systemd-Timer (scripts/systemd/varda-ingest.*):
# rechnen (scripts/varda-ingest.py), dann nach R2 hochladen. Läuft auf dem
# Laptop, nicht im Deploy — GitHub Actions hat keine GPU.
#
# Einstellungen und Zugangsdaten aus ~/.config/meteojunkie/varda.env (chmod 600):
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID   für den Upload
#   VARDA_HOME, VARDA_WORK, VARDA_LD_LIBRARY_PATH                   optional
# Fehlen die R2-Angaben, wird nur gerechnet (lokal sichtbar über `npm run dev`).
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${VARDA_ENV:-$HOME/.config/meteojunkie/varda.env}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

# Ohne Netz kein Lauf — sauber beenden statt mit Fehler. NICHT nm-online:
# direkt nach dem Aufwachen meldet NetworkManager noch den Zustand von vor
# der Bereitschaft, nm-online kehrt sofort zurück, und der erste Abruf
# scheiterte an der Namensauflösung (so am 03.11. und 04.11., jeder Lauf
# tot). Gewartet wird deshalb, bis der Host der Startwerte WIRKLICH antwortet.
net_ok() { curl -sfI --max-time 10 -o /dev/null https://data.geo.admin.ch/api/stac/v1/; }
for _ in $(seq 60); do net_ok && break; sleep 10; done
if ! net_ok; then
  echo "kein Netz nach 10 Minuten — kein Lauf"
  exit 0
fi

VARDA_HOME="${VARDA_HOME:-$HOME/varda-test}"
export VARDA_HOME
export PATH="$HOME/.local/bin:$PATH"

# Erzeugungszeit statt Laufkennung: ein neu gerechneter Lauf mit derselben
# Kennung (vorher nur ein Probelauf mit --lead 12) muss trotzdem hoch
stamp() { grep -o '"generated":"[^"]*"' public/nwp/varda/meta.json 2>/dev/null || true; }
before=$(stamp)
"$VARDA_HOME/.venv-fc/bin/python" scripts/varda-ingest.py "$@"
after=$(stamp)

if [[ "$before" == "$after" ]]; then
  echo "kein neuer Lauf — nichts hochzuladen"
  exit 0
fi
if [[ -z "${R2_ACCESS_KEY_ID:-}" ]]; then
  echo "keine R2-Zugangsdaten in $ENV_FILE — nur lokal abgelegt"
  exit 0
fi
scripts/upload-data.sh nwp/varda
