# Prompt für Claude Code — Phase 3: Synoptische Workbench (6‑Panel‑Karten)

> **So benutzt du dieses Dokument, Felix:** Öffne dein Repo in Claude Code und füge den Block **„MASTER‑PROMPT"** unten als erste Nachricht ein. Claude Code arbeitet dann Schritt 0 → 7 ab, committet nach jedem Schritt und stoppt zur Kontrolle. Wenn du lieber kleinteilig steuern willst, gibt es weiter unten jeden Schritt noch einmal einzeln zum Einzeln‑Servieren (Abschnitt „Einzel‑Prompts").
>
> Dieses Dokument ist bewusst so geschrieben, dass Claude Code **zuerst deinen bestehenden Code inventarisiert** und sich anpasst — die Annahmen unten sind Vorschläge, keine Vorgaben.

---

## 0. Kontext (in den Prompt kopieren)

Projekt „Meteorologie-Website". Bisher gebaut:

- **Phase 1:** Meteogramme pro Gitterpunkt per Klick auf einer zoombaren Landkarte, aus ECMWF Open Data.
- **Phase 2:** Anbindung weiterer frei verfügbarer Modelldaten (ICON, GFS, …).

**Phase 3 = Ziel dieses Prompts:** eine *synoptische Workbench* — eine Ansicht mit **6 synchronisierten Kartenpanels**, jedes zeigt ein anderes meteorologisches Feld (T850, T2m, rr3h/rr6h, 500 hPa Geopotential, MSLP, Jet …). Gemeinsamer Zeitschieber mit Animation, synchronisiertes Pan/Zoom, Modell-/Laufauswahl, Klick auf einen Punkt öffnet das bestehende Meteogramm.

---

## 1. Datengrundlage (verifiziert, Stand Juli 2026)

**ECMWF Open Data (IFS/HRES, `oper`/`type=fc`):**

- Auflösung **0.25°**, GRIB2, Läufe **00/06/12/18 UTC**.
- Schritte: 00/12 UTC → `0–144h` in 3h, `150–240h` in 6h, verlängert bis `360h` in 6h. 06/18 UTC → nur `0–90h` in 3h.
- **Single-Level-Parameter:** `10u`, `10v`, `2t`, `msl`, `ro`, `skt`, `sp`, `st`, `stl1`, `tcwv`, `tp`.
- **Druckflächen-Parameter:** `d`, `gh`, `q`, `r`, `t`, `u`, `v`, `vo` auf Levels **1000, 925, 850, 700, 500, 300, 250, 200, 50 hPa**.
- Zugriff über den Python-Client `ecmwf-opendata` (lädt via Index-Dateien nur die benötigten GRIB-Messages als Byte-Ranges — kein Voll-Download):

```python
from ecmwf.opendata import Client
client = Client(source="ecmwf")   # alt.: source="azure" / "aws" bei Ausfall
client.retrieve(
    time=0, stream="oper", type="fc",
    step=[0, 3, 6],                # oder Bereich
    param=["2t", "msl", "tp"],     # Single-Level
    target="sfc.grib2",
)
client.retrieve(
    time=0, stream="oper", type="fc",
    step=[0, 3, 6],
    param=["t", "gh", "u", "v", "vo"],
    levelist=[850, 500, 300],      # Druckflächen
    target="pl.grib2",
)
```

- **AIFS** (KI-Modell von ECMWF) ist ebenfalls Open Data und kann später als weiteres „Modell" ergänzt werden.
- **DWD ICON** (Global ~13 km, ICON-EU ~7 km, ICON-D2 ~2 km) über `opendata.dwd.de`, GRIB2, eine Datei je Parameter/Schritt (bzip2). **GFS** über NOMADS. Falls Phase 2 diese schon integriert hat: dieselbe Feld-Registry (Schritt 1) wiederverwenden, nur Loader je Modell.

**Wichtige Ableitungen (Backend rechnet, Frontend zeigt nur):**

- **rr3h / rr6h:** `tp` ist *akkumulierter* Gesamtniederschlag in **Metern** ab Laufbeginn. Intervall-Niederschlag = `tp(step) − tp(step−Δ)`, dann `×1000` → mm. rr3h: Δ=3h; rr6h: Δ=6h (nur auf 6h-Rasterschritten).
- **Windgeschwindigkeit/-richtung:** aus `u`,`v`. Für Barbs meist in **Knoten** (`m/s × 1.94384`).
- **1000–500 hPa Schichtdicke (rel. Topografie):** `gh(500) − gh(1000)`, in **dam**; 540er-Linie hervorheben (grobe Schnee-/Regen-Grenze).
- **Absolute Vorticity:** `vo + f` (Coriolis `f = 2Ω sin φ`), Anzeige skaliert `×10⁻⁵ s⁻¹`.
- **Einheiten:** Temperatur `K → °C` (`−273.15`); Druck `Pa → hPa` (`/100`); `gh` ist bereits in Metern (Anzeige oft in **gpdm** = `/10`).

---

## 2. Empfohlene Architektur (anpassen an Bestehendes)

Wenn Phase 1/2 bereits Python fürs Backend nutzen (wahrscheinlich, wegen `cfgrib`/`xarray`/`eccodes`), diesen Weg weitergehen:

- **Backend:** Python + **FastAPI**. GRIB-Verarbeitung mit `xarray`+`cfgrib` (eccodes), Ableitungen mit `numpy`, Konturen mit `contourpy`/`matplotlib`, optional `metpy` für meteorologische Helfer.
- **Rendering-Strategie (Hybrid):**
  - **Flächenfelder** (T2m, T850, Niederschlag, Vorticity, Jet): serverseitig per Colormap-LUT in ein **farbcodiertes PNG** rendern (numpy → PIL), im Browser als georeferenzierter Raster-Layer. Schnell, cache-bar je (Feld, Lauf, Schritt, Domain).
  - **Linienfelder** (Geopotential, Isobaren, Schichtdicke): serverseitig **Konturen → GeoJSON**, im Browser als Vektorlinien mit Labels.
  - **Wind:** Barbs als dekodierte Punkt-Symbole (GeoJSON mit Rotation) auf ausgedünntem Gitter; optional animierte Streamlines (WebGL) als Stretch-Goal.
  - **Punkt-Probe:** Endpoint liefert Werte aller Felder an einer Lat/Lon für Crosshair-Readout.
- **Frontend:** die vorhandene Kartenbasis nutzen. Falls Leaflet → für 6 GPU-Panels ist **MapLibre GL JS** robuster; sonst beim Bestehenden bleiben und Layer-Komposition kapseln.
- **Ingest/Cache:** Scheduler pollt die ECMWF-Dissemination (Verfügbarkeit ~7–9 h nach Lauf; Index-Dateien prüfen, nicht auf feste Uhrzeit verlassen), zieht Panel-Parameter, berechnet Ableitungen, legt Zwischenstand ab (Zarr/NetCDF oder gerenderte Kacheln). Custom-Domains on-demand rendern + cachen.

---

## 3. Panel-Preset-Katalog (die meteorologische Substanz)

**Standard „Synoptische Übersicht" (Default-Preset, 3×2):**

| # | Feld (Füllung) | Overlay (Kontur) | Zusatz | Konvention |
|---|---|---|---|---|
| 1 | 500 hPa rel. Vorticity (`vo`, ×10⁻⁵) | 500 hPa Geopotential (`gh`) | — | GPH alle **4 gpdm** (40 gpm), Vort. divergierende Colormap um 0 |
| 2 | 1000–500 hPa Schichtdicke | MSLP (`msl`) | 540er Linie fett | Schichtdicke alle **4 dam**; Isobaren alle **5 hPa** |
| 3 | 850 hPa Temperatur (`t`) | 850 hPa Geopotential | Wind 850 (Barbs, kn) | T alle **2 K**, 0 °C-Linie hervorgehoben |
| 4 | 2 m Temperatur (`2t`) | MSLP (Isobaren) | — | T-Colormap (blau↔rot), 0 °C markiert |
| 5 | rr6h Niederschlag | MSLP (Isobaren) | — | Schwellen 0.1/0.5/1/2/5/10/20/30/50 mm |
| 6 | 300 hPa Windgeschw./Jet | 300 hPa Geopotential | — | Jet-Füllung ab **60/80/100/120 kn** |

**Weitere Presets** (per Dropdown wählbar): „Konvektion" (CAPE/Shear/rr3h/700 RH/…), „Winter" (T850/Schneefallgrenze/rr/2t/MSLP), „Frei konfigurierbar" (jedes Panel einzeln setzen). Presets als JSON-Definition ablegen, damit sie ohne Code-Änderung erweiterbar sind.

**Colormap-/Kontur-Konventionen zentral definieren** (ein `field_registry`), damit alle Panels konsistent aussehen. Für Farbwahl (sequentiell/divergierend, dark/light, Barrierefreiheit) die **`dataviz`-Skill** heranziehen, bevor Farben festgelegt werden.

---

## 4. Feld-Registry (Kernabstraktion — zuerst bauen)

Ein zentrales, typisiertes Register beschreibt jedes darstellbare Feld deklarativ:

```
FieldSpec:
  id: "t850"                      # eindeutig
  label: "850 hPa Temperatur"
  source: {param: "t", level: 850}     # oder derived
  derived: null | "rr3h" | "rr6h" | "thickness_1000_500" | "wspd" | "absvort"
  unit_display: "°C"
  transform: K→°C                 # Funktions-Referenz
  render: "fill" | "contour" | "barbs"
  colormap: "<id aus dataviz>"    # nur bei fill
  levels: [contour-Intervalle]    # nur bei contour
  highlight: [0]                  # hervorgehobene Linien
  models: ["ecmwf","icon","gfs"]  # wo verfügbar
```

Alles Weitere (Rendering-Endpoints, Panel-Config, Presets) referenziert nur `field.id`. Das hält Modelle, Ableitungen und Darstellung entkoppelt.

---

## 5. API-Vertrag (Skizze, Backend)

```
GET /api/models                         → verfügbare Modelle + neueste Läufe
GET /api/runs?model=ecmwf               → Läufe + Schritte + Feldverfügbarkeit
GET /api/fields                         → Feld-Registry (für UI)
GET /api/presets                        → Panel-Presets
GET /api/field/{field_id}/raster.png    ?model&run&step&bbox&width&height   → farbcodiertes Flächen-PNG (+Colorbar-Meta im Header/Sidecar)
GET /api/field/{field_id}/contours.json ?model&run&step&bbox                → GeoJSON Linien + Labels
GET /api/field/{field_id}/barbs.json    ?model&run&step&bbox&thin           → GeoJSON Windbarbs
GET /api/probe                          ?model&run&step&lat&lon&fields=...   → Werte aller Felder am Punkt
```

Antworten aggressiv cachen (Key = alle Query-Parameter). Nachbar-Schritte prefetchen für flüssige Animation.

---

## 6. Umsetzungs-Roadmap (Schritte 0–7)

**Schritt 0 — Inventur & Plan.** Repo lesen, Stack/Struktur ermitteln (wo Meteogramme, GRIB-Ingest, Kartenkomponente leben), kurze Architektur-Notiz + konkreten Umsetzungsplan schreiben, offene Annahmen benennen. *Noch nicht coden.*

**Schritt 1 — Datenschicht.** Ingest um Panel-Parameter erweitern; Ableitungen (rr3h/rr6h, wspd, Schichtdicke, absvort) implementieren + unit-getestet; **Feld-Registry** (Abschnitt 4) einführen.

**Schritt 2 — Rendering-Services.** Endpoints aus Abschnitt 5: `raster.png`, `contours.json`, `barbs.json`, `probe`. Colormap-LUTs vorberechnen. Ein Feld end-to-end über die API sichtbar machen.

**Schritt 3 — Einzel-Panel-Komponente.** Wiederverwendbares Panel: Basiskarte + Fill + Kontur + Barbs für **eine** `FieldSpec`, mit Titel, Colorbar und Wert-Readout.

**Schritt 4 — 6-Panel-Grid + Sync.** 3×2-Layout, synchronisiertes Pan/Zoom (gemeinsamer View-State), gemeinsamer **Zeitschieber + Play/Pause-Animation**, Domain-Presets (Europa/Deutschland/Nordatlantik/Custom), Layout-Presets (Abschnitt 3).

**Schritt 5 — Modell-/Laufauswahl + Vergleich.** Modell-Umschalter (ECMWF/ICON/GFS/AIFS), Laufauswahl, **Vergleichsmodus** (gleiches Feld, zwei Läufe/Modelle nebeneinander).

**Schritt 6 — Meteogramm-Integration + Probe.** Klick auf Panelpunkt → bestehendes Meteogramm (Phase 1) als Popup; Crosshair-Readout über alle 6 Panels via `/probe`.

**Schritt 7 — Performance, Cache, Tests.** Schritt-Prefetch, Feld-/Kachel-Cache, Ladezustände, Unit-Tests (Ableitungen, Einheiten), 1–2 Visual-Checks (Screenshot rendern & prüfen), Verifikations-Checkliste abarbeiten.

---

## 7. Arbeitsweise für Claude Code (Execution-Protokoll)

- **Vertikale Slices:** jeder Schritt endet in etwas Sichtbarem/Testbarem, nicht in Halbfertigem.
- Nach jedem Schritt **committen** (klare Message) und **kurz zusammenfassen**, dann stoppen/checken.
- **Kein Voll-Download** von GRIB — Index-/Byte-Range-Weg des `ecmwf-opendata`-Clients nutzen; sparsam mit Speicher/Bandbreite.
- Ableitungen **gegen einen bekannten Referenzwert** prüfen (z. B. T850 an einem Punkt mit einer externen Quelle plausibilisieren; rr summiert = tp-Differenz).
- Bestehende Konventionen/Utilities aus Phase 1/2 **wiederverwenden**, nicht duplizieren.
- Bei Farben/Legenden/Dashboard-Layout die **`dataviz`-Skill** lesen, bevor Farbwerte gesetzt werden.
- Annahmen, die sich als falsch erweisen, sofort melden statt weiterraten.

**Abnahmekriterien Phase 3:** 6 Panels rendern synchron das Default-Preset für einen echten ECMWF-Lauf; Zeitschieber animiert flüssig durch die Schritte; Pan/Zoom ist synchronisiert; Modell-/Laufwechsel funktioniert; Klick öffnet Meteogramm; rr6h und Schichtdicke sind numerisch korrekt (Test).

---

## 8. Stretch-Goals (nach Phase 3, nur benennen)

Animierte Wind-Streamlines (WebGL, Windy-Stil) · Vertikale Querschnitte entlang einer gezogenen Linie · Ensemble-Panels (Spread/Probabilities aus `enfo`) · AIFS vs. IFS Direktvergleich · Zeit-Loop-Export als GIF/MP4 · teilbare Permalinks (Modell+Lauf+Domain+Preset+Step in der URL).

---

## MASTER-PROMPT (das hier in Claude Code einfügen)

> Wir bauen **Phase 3** der Meteorologie-Website: eine **synoptische Workbench** mit 6 synchronisierten Kartenpanels. Lies zuerst dieses gesamte Briefing (Abschnitte 1–8 oben; ich füge es mit ein) und dann **Schritt 0**: inventarisiere das Repo, ermittle Stack/Struktur (Meteogramm-Code, GRIB-Ingest, Kartenkomponente) und schreib mir eine kurze Architektur-Notiz + Umsetzungsplan mit deinen Annahmen — **coden erst nach meiner Freigabe**. Danach arbeite die Roadmap Schritt 1→7 in vertikalen Slices ab, committe und fasse nach jedem Schritt zusammen und stoppe zur Kontrolle. Halte dich an die verifizierten Datendetails (ECMWF Open Data 0.25°, `ecmwf-opendata`-Client, Ableitungen rr3h/rr6h/Schichtdicke/wspd) und die Feld-Registry als zentrale Abstraktion. Nutze die `dataviz`-Skill für alle Farb-/Legendenentscheidungen. Reuse bestehender Utilities aus Phase 1/2 statt Duplikaten.

---

### Einzel-Prompts (falls du lieber Schritt für Schritt servierst)

**→ Schritt 0:** „Inventarisiere das Repo für Phase 3 (synoptische Workbench). Finde: wo die Meteogramme erzeugt werden, wie GRIB-Daten geladen/verarbeitet werden, welche Kartenbibliothek das Frontend nutzt. Schreib eine kurze Architektur-Notiz + Umsetzungsplan für die 6-Panel-Workbench und liste deine Annahmen. Noch nicht coden."

**→ Schritt 1:** „Erweitere die Datenschicht: lade die Panel-Parameter (2t, msl, tp, t/gh/u/v/vo auf 850/500/300) via ecmwf-opendata-Client, implementiere die Ableitungen rr3h, rr6h, Windgeschwindigkeit, 1000–500 Schichtdicke, absolute Vorticity mit Unit-Tests, und führe eine zentrale Feld-Registry (FieldSpec) ein. Danach committen + zusammenfassen."

**→ Schritt 2:** „Baue die Rendering-Services: FastAPI-Endpoints raster.png (farbcodiertes Flächenfeld via Colormap-LUT), contours.json (GeoJSON-Linien+Labels), barbs.json, probe. Mach ein Feld end-to-end über die API sichtbar. Farbwahl mit der dataviz-Skill. Committen + zusammenfassen."

**→ Schritt 3:** „Baue die wiederverwendbare Einzel-Panel-Komponente: Basiskarte + Fill + Kontur + Barbs für eine FieldSpec, mit Titel, Colorbar, Wert-Readout. Committen + zusammenfassen."

**→ Schritt 4:** „Baue das 3×2-Panel-Grid mit synchronisiertem Pan/Zoom, gemeinsamem Zeitschieber + Animation, Domain-Presets und dem Default-Preset ‚Synoptische Übersicht'. Committen + zusammenfassen."

**→ Schritt 5:** „Füge Modell-/Laufauswahl (ECMWF/ICON/GFS/AIFS) und einen Vergleichsmodus (gleiches Feld, zwei Läufe/Modelle) hinzu. Committen + zusammenfassen."

**→ Schritt 6:** „Integriere: Klick auf einen Panelpunkt öffnet das bestehende Meteogramm als Popup; Crosshair-Readout über alle Panels via /probe. Committen + zusammenfassen."

**→ Schritt 7:** „Performance-Runde: Schritt-Prefetch, Feld-/Kachel-Cache, Ladezustände, Unit-Tests für die Ableitungen, 1–2 Visual-Checks per Screenshot. Arbeite die Abnahmekriterien ab und melde den Stand."
