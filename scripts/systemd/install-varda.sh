#!/usr/bin/env bash
# Richtet den Varda-Timer für den angemeldeten Benutzer ein (kein sudo nötig).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.config/systemd/user ~/.config/meteojunkie
cp "$here/varda-ingest.service" "$here/varda-ingest.timer" ~/.config/systemd/user/
if [[ ! -f ~/.config/meteojunkie/varda.env ]]; then
  umask 077
  cat > ~/.config/meteojunkie/varda.env <<'ENV'
# Zugangsdaten für den Upload nach R2 (Cloudflare → R2 → API-Token mit
# Schreibrecht auf meteojunkie-daten). Leer = nur lokal rechnen.
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
CLOUDFLARE_ACCOUNT_ID=
# Nur nötig ohne `apt install libgfortran5`:
# VARDA_LD_LIBRARY_PATH=/pfad/mit/libgfortran.so.5
ENV
fi
systemctl --user daemon-reload
systemctl --user enable --now varda-ingest.timer
# Ohne „linger" laufen Benutzer-Timer nur, solange man angemeldet ist
loginctl enable-linger "$USER" || echo "Hinweis: 'loginctl enable-linger $USER' braucht ggf. sudo"
systemctl --user list-timers varda-ingest.timer
