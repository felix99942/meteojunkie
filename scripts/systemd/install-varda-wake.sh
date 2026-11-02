#!/usr/bin/env bash
# Richtet das Wecken aus der Bereitschaft für den Varda-Lauf ein (braucht
# sudo, weil nur System-Timer wecken dürfen):
#   sudo scripts/systemd/install-varda-wake.sh
# Entfernen:
#   sudo systemctl disable --now varda-wake.timer
#   sudo rm /etc/systemd/system/varda-wake.* /usr/local/lib/meteojunkie/varda-wake.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "bitte mit sudo aufrufen"; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
user="${SUDO_USER:?mit sudo aus dem eigenen Konto aufrufen}"
install -D -o root -g root -m 755 "$here/varda-wake.sh" /usr/local/lib/meteojunkie/varda-wake.sh
install -o root -g root -m 644 "$here/varda-wake.timer" /etc/systemd/system/varda-wake.timer
sed "s/@USER@/$user/" "$here/varda-wake.service" > /etc/systemd/system/varda-wake.service
chmod 644 /etc/systemd/system/varda-wake.service
systemctl daemon-reload
systemctl enable --now varda-wake.timer
systemctl list-timers varda-wake.timer --no-pager
echo "Eingerichtet. Test des Weckens (Laptop schläft 90 s und wacht auf): sudo rtcwake -m mem -s 90"
