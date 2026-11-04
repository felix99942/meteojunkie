#!/usr/bin/env bash
# Läuft als root aus varda-wake.timer (WakeSystem): wartet aufs Netz, startet
# den Varda-Lauf des Benutzers und legt den Laptop danach wieder schlafen —
# aber NUR, wenn dieser Timer ihn geweckt hat und die Sitzung noch gesperrt
# ist. Wer inzwischen daran arbeitet, wird nicht schlafen gelegt.
#
# Ohne Netz (WLAN nach 10 min nicht da): kein Lauf, zurück in die
# Bereitschaft; der nächste Termin holt den dann neuesten Lauf.
#
# Solange gewartet und gerechnet wird, hält das Skript eine Sperre gegen
# Bereitschaft, Inaktivitäts-Bereitschaft und den Deckelschalter: mit
# geschlossenem Deckel geweckt, legt logind den Laptop sonst nach ~30 s
# wieder schlafen.
set -uo pipefail
user="${1:?Benutzer fehlt}"
log() { echo "[varda-wake] $*"; }

if [[ "${2:-}" != --inner ]]; then
  # Hat DIESER Timer geweckt? Dann kam die Rückkehr aus der Bereitschaft
  # eben erst (der Timer feuert unmittelbar nach dem Aufwachen)
  # Der Timer feuert, BEVOR die Rückkehr abgeschlossen ist: logind steckt
  # noch in der Operation „suspend" (dann lehnt systemd-inhibit mit „already
  # running" ab, und der Lauf fiel aus), und systemd-sleep hat „returned from
  # sleep" noch nicht geschrieben. Erst abwarten, bis die Bereitschaft
  # wirklich vorbei ist (gemessen ~2 s, Frist 60 s).
  for _ in $(seq 60); do
    systemctl is-active -q systemd-suspend.service || break
    sleep 1
  done
  sleep 2
  woke=no
  journalctl -b --since "-3 min" -o cat -t systemd-sleep 2>/dev/null | grep -q "returned from sleep" && woke=yes
  log "geweckt vom Timer: $woke"
  # Wiederholt, falls logind die Sperre trotzdem noch ablehnt — die Ablehnung
  # kommt sofort, ein echter Lauf dauert Minuten
  for try in 1 2 3 4 5 6; do
    start=$SECONDS
    systemd-inhibit --what=sleep:idle:handle-lid-switch --who=varda --why="Varda-Lauf" --mode=block \
      "$0" "$user" --inner && break
    (( SECONDS - start > 5 )) && break
    log "Sperre abgelehnt, neuer Versuch ($try)"
    sleep 5
  done
  # Wieder schlafen nur, wenn der Timer geweckt hat UND die grafische Sitzung
  # gesperrt ist (bzw. es keine gibt) — LockedHint setzt GNOME beim Sperren
  sid=$(loginctl list-sessions --no-legend | awk -v u="$user" '$3 == u && $4 == "seat0" { print $1; exit }')
  locked=yes
  [[ -n "$sid" ]] && locked=$(loginctl show-session "$sid" -p LockedHint --value)
  if [[ $woke == yes && $locked == yes ]]; then
    log "zurück in die Bereitschaft"
    systemctl suspend
  else
    log "bleibt wach (geweckt: $woke, gesperrt: $locked)"
  fi
  exit 0
fi

# Aufs Netz warten: bis der Name des Startwert-Hosts auflösbar ist (nm-online
# meldet direkt nach dem Aufwachen noch den alten Zustand), höchstens 10 min
net_ok() { getent hosts data.geo.admin.ch >/dev/null; }
for _ in $(seq 60); do net_ok && break; sleep 10; done
if ! net_ok; then
  log "kein Netz nach 10 Minuten — kein Lauf"
  exit 0
fi
# Startet den Benutzerdienst und wartet, bis der Lauf durch ist (oneshot)
if systemctl --user -M "$user@" start varda-ingest.service; then
  log "Varda-Lauf fertig"
else
  log "Varda-Lauf mit Fehler beendet (Protokoll: journalctl --user -u varda-ingest)"
fi
