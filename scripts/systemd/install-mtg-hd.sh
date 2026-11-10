#!/usr/bin/env bash
# Richtet den MTG-HD-Timer für den angemeldeten Benutzer ein (kein sudo nötig).
# Vorher: Python-Umgebung in ~/mtg-hd (pip install -r scripts/requirements-mtg-hd.txt)
# und ~/.config/meteojunkie/eumetsat.env mit CONSUMER_KEY/CONSUMER_SECRET (chmod 600).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.config/systemd/user
cp "$here/mtg-hd.service" "$here/mtg-hd.timer" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mtg-hd.timer
systemctl --user list-timers mtg-hd.timer
