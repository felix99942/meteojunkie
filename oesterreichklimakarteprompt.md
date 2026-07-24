# Prompt für Claude Code — Österreich-Klimakarte (TAWES-Stationen, Analogon zu mtwetter.de)

> **So benutzt du das, Felix:** Master-Prompt unten in Claude Code einfügen. Es inventarisiert erst dein Repo (gibt es schon eine Deutschland-/Stationskarte? → Komponente wiederverwenden), dann baut es die Österreich-Sektion Schritt 0→6. Einzel-Prompts stehen darunter.

---

## 1. Was gebaut werden soll

Ein neuer, eigenständiger Bereich der Website: **Österreich-Klimakarte**.

- Eine **große (statische) Karte von Österreich** mit allen **TAWES-Stationen** von GeoSphere Austria als Punkte (Position aus Lat/Lon).
- Ein **Dropdown mit sämtlichen klimatologischen Werten** (Temperatur Mittel/Max/Min, Niederschlag, Sonnenschein, Schnee, Wind, …) plus Zeit-/Aggregationswahl (Tag, Monat, Jahr, langjähriges Mittel, Rekorde).
- Auswahl im Dropdown → jede Station wird nach dem gewählten Wert **eingefärbt/beschriftet**, mit Legende/Colorbar.
- **Klick auf eine Station** → Detailansicht mit Zeitreihe/Meteogramm, Klimamitteln und Rekorden — **analog zur bestehenden Deutschland-Karte** bzw. zum Interaktionsmodell von mtwetter.de.

**Vorbild mtwetter.de** (gescannt): interaktive DWD-Stationskarte, Parameter per „Ein-Klick" wählbar (Temperatur Max/Min/Mittel; Niederschlag Tages-/Monatssummen und %-Vergleich zum Mittel; Sonnenschein Stunden und %; nationale/lokale Rekorde), pro Station Meteogramme (Monat/Saison/Jahr), Regionen-Zeitreihen ab 1881. Dieses Interaktionsmodell 1:1 für Österreich nachbauen.

---

## 2. Datenquelle (verifiziert, Stand Juli 2026) — und warum sie API-günstig ist

**GeoSphere Austria Data Hub — Dataset API v1** (ehem. ZAMG), offen, **kein API-Key nötig**, Lizenz CC BY 4.0.

- Basis-URL: `https://dataset.api.hub.geosphere.at/v1`
- URL-Muster: `/<type>/<mode>/<resource_id>` mit `type` ∈ {`station`, `timeseries`, `grid`}, `mode` ∈ {`historical`, `current`, `forecast`}.
- **Alle Datensätze auflisten:** `GET /v1/datasets`
- **Stationsliste + Koordinaten (für die Kartenpunkte):**
  `GET /v1/station/historical/klima-v2-1d/metadata` → liefert Stations-IDs, Namen, **Lat/Lon**, Höhe, Gültigkeitszeitraum, verfügbare `parameters`.
- **Zeitreihe je Station(en):**
  `GET /v1/timeseries/historical/klima-v2-1d?parameters=tl,rr&start=1991-01-01&end=2020-12-31&station_ids=105,111&output_format=geojson`
- Output: `json` / `geojson` / `csv`.

**Relevante Datensätze:**

| resource_id | Inhalt | Nutzung |
|---|---|---|
| `klima-v2-1d` | **Tägliche** Klimadaten je Station | Hauptquelle Kartenwerte + Zeitreihen |
| `klima-v2-1m` | **Monatliche** Klimadaten je Station | Monatswerte, Mittel, Anomalien |
| `tawes-v1-10min` | TAWES 10-Minuten (aktuell) | optional: „aktueller Wert"-Layer |
| `synop-v1-1h` | SYNOP stündlich | optional |

**Warum günstig (der springende Punkt):**

1. Das Stationsnetz ist **fix und klein** (~250–280 Stationen). Eine ganze Kartenansicht = **ein** Request über *alle* `station_ids` gleichzeitig für den gewählten Parameter/Zeitraum — nicht ein Request pro Punkt.
2. **Historische Klimadaten sind statisch** — einmal geladen, **unbegrenzt cachebar** (kein erneuter Abruf). Langjährige Mittel (1991–2020) und Rekorde einmal vorberechnen und ablegen.
3. Kein Key, großzügig; große Zeiträume ggf. serverseitig in Chunks laden (Max-Records pro Request beachten) und persistent cachen.

> Gegen-Merksatz zur Vorhersagekarte: **Fläche = Feld/GRIB. Stationsnetz = eine Handvoll Punkte, komplett cachebar.** Deshalb kostet diese Sektion praktisch nichts.

---

## 3. Architektur

- **Ingest / Backend (Python, analog Phase 1):**
  - `stations.json` einmal aus dem `/metadata`-Endpoint ziehen (ändert sich selten) → Stationsliste mit Koordinaten/Höhe/Zeitraum lokal ablegen.
  - Parameter-/Zeitwerte on-demand aus `klima-v2-1d`/`-1m` laden, **persistent cachen** (Key = param+datum/zeitraum+aggregat). Historisch = für immer gültig.
  - Langjährige Normalwerte (1991–2020), Rekorde (min/max über die Stationshistorie) und Monatsmittel **vorberechnen** und als abgeleitete Tabellen ablegen (analog mtwetters „%-Vergleich zum Mittel").
- **Frontend:**
  - **Statische Österreich-Karte:** Landesgrenze als GeoJSON/SVG (z. B. aus Natural Earth / GADM Österreich), Stationen als Punkte per Lat/Lon projiziert. Kein Slippy-Map nötig — feste Projektion (z. B. einfache Lat/Lon- oder eine AT-taugliche wie ETRS89/Austria Lambert), reicht für eine Übersichtskarte und ist leichtgewichtig.
  - **Dropdown(s):** (a) klimatologischer Parameter, (b) Zeitbezug/Aggregat (konkreter Tag · Monat · Jahr · langjähriges Mittel · Rekord). Auswahl färbt Stationen via Colorbar.
  - **Klick auf Station** → Detailpanel: Zeitreihe/Meteogramm (bestehende Phase-1-Komponente wiederverwenden, nur GeoSphere als Quelle), Klimamittel, Rekorde.
  - Farbwahl/Legende/Colorbar mit der **`dataviz`-Skill** (sequentiell für Temperatur/Sonne, für Anomalien divergierend um 0, barrierefrei light/dark).

**Wenn im Repo bereits eine Deutschland-/Stationskarte existiert:** deren Komponente/Muster wiederverwenden und nur Quelle (GeoSphere statt DWD), Geometrie (AT statt DE) und Stationssatz austauschen — nicht neu bauen.

---

## 4. Dropdown-Katalog (klimatologische Werte)

Die konkret verfügbaren `parameters` **aus dem `/metadata`-Endpoint auslesen** und auf lesbare Labels mappen (nicht hart kodieren — GeoSphere-Kürzel können sich ändern). Erwartete Kategorien, analog mtwetter:

- **Temperatur:** Mittel, Maximum, Minimum (Tag/Monat/Jahr), langjähriges Mittel, Abweichung vom Mittel.
- **Niederschlag:** Summe (Tag/Monat/Jahr), Anzahl Niederschlagstage, **%-Vergleich zum langjährigen Mittel**.
- **Sonnenschein:** Dauer (Stunden, Monatssumme), %-Vergleich.
- **Schnee:** Schneehöhe, Neuschnee, Schneedeckentage.
- **Wind:** Mittel, Spitzenböe; **Luftdruck**, **Luftfeuchte** (optional).
- **Rekorde:** höchster/niedrigster je Station (lokal) und österreichweit (national) — analog mtwetters Rekord-Ansicht.

Jeder Eintrag als deklarative Definition (Parametercode → Label, Einheit, Aggregat, Colormap, ob Anomalie/absolut) — eine **Parameter-Registry** analog zur `FieldSpec` aus dem Workbench-Dokument, damit Karte, Legende und Detailpanel konsistent bleiben.

---

## 5. API-Vertrag (dein Backend, cachend vor GeoSphere)

```
GET /api/at/stations                         → Stationen (id, name, lat, lon, höhe, zeitraum) [gecacht]
GET /api/at/parameters                        → verfügbare Parameter + Labels/Einheiten (aus /metadata) [gecacht]
GET /api/at/map?param=&when=&agg=            → je Station 1 Wert für die gewählte Auswahl (1 Bulk-Request) [gecacht]
GET /api/at/station/{id}?param=&start=&end=  → Zeitreihe für Detailpanel/Meteogramm [gecacht]
GET /api/at/normals?param=&period=1991-2020  → langjährige Mittel je Station [vorberechnet]
GET /api/at/records?param=                    → Rekorde je Station + national [vorberechnet]
```

Immer serverseitig cachen; historische Antworten nie invalidieren.

---

## 6. Roadmap (Schritte 0–6)

**Schritt 0 — Inventur.** Repo lesen: Gibt es eine bestehende Deutschland-/Stationskarte, ein Karten-/Meteogramm-Modul, ein Caching? Kurze Notiz + Plan, ob wiederverwendet oder neu. *Noch nicht coden.*

**Schritt 1 — Stationsstammdaten.** `GET /v1/station/historical/klima-v2-1d/metadata` einmal ziehen, `stations.json` (id, name, lat, lon, höhe, zeitraum, parameters) ablegen; `/api/at/stations` + `/api/at/parameters` bereitstellen. Verifizieren: Stationszahl plausibel (~250–280), Koordinaten in AT-Bounding-Box.

**Schritt 2 — Statische AT-Karte + Stationspunkte.** Grenz-GeoJSON rendern, Stationen als Punkte platzieren, Hover-Tooltip (Name/Höhe). Noch ohne Werte.

**Schritt 3 — Werte-Layer + Dropdown.** Parameter-Registry (Abschnitt 4); `GET /api/at/map` als **ein** Bulk-Request über alle Stationen; Stationen einfärben + Colorbar/Legende (dataviz-Skill). Persistent cachen.

**Schritt 4 — Stationsdetail/Meteogramm.** Klick → Detailpanel mit Zeitreihe (bestehende Meteogramm-Komponente, Quelle GeoSphere), Klimamittel, Rekorde.

**Schritt 5 — Normale, Anomalien, Rekorde.** `normals` (1991–2020) und `records` vorberechnen; Dropdown-Optionen „Abweichung vom Mittel" (%/K, divergierende Colormap) und „Rekorde" ergänzen — analog mtwetters %-Vergleich.

**Schritt 6 — Feinschliff + Tests.** Caching prüfen, Ladezustände, Unit-Tests (Einheiten, Anomalie-/%-Berechnung, min/max-Rekorde), 1–2 Visual-Checks (Screenshot). Abnahme: eine Kartenauswahl = genau **ein** GeoSphere-Request; wiederholte Auswahl = 0 Requests (Cache).

---

## 7. Arbeitsweise für Claude Code

Vertikale Slices, nach jedem Schritt committen + zusammenfassen + stoppen. Parameter/Kürzel **immer aus `/metadata` lesen**, nicht raten. Historische Daten aggressiv und dauerhaft cachen. Bestehende Karten-/Meteogramm-Utilities wiederverwenden. Farben/Legenden über die `dataviz`-Skill. Sehr lange Reihen (z. B. HISTALP/Wien ab 18. Jh.) sind ein späteres Stretch-Goal, nicht Teil dieser Sektion.

---

## MASTER-PROMPT (in Claude Code einfügen)

> Wir bauen einen neuen Bereich der Meteorologie-Website: eine **Österreich-Klimakarte** — große statische Österreich-Karte mit allen **TAWES-Stationen** (GeoSphere Austria), einem **Dropdown für sämtliche klimatologischen Werte**, Einfärbung der Stationen nach Auswahl, Klick öffnet ein Stationsdetail/Meteogramm. Vorbild ist das Interaktionsmodell von **mtwetter.de** und, falls vorhanden, unsere bestehende Deutschland-Karte.
>
> **Schritt 0, erst diagnostizieren:** Inventarisiere das Repo — gibt es schon eine Deutschland-/Stationskarte, eine Meteogramm-Komponente, ein Caching-Layer, die ich wiederverwenden kann? Schreib eine kurze Notiz + Umsetzungsplan, **coden erst nach Freigabe.**
>
> **Datenquelle (verifiziert):** GeoSphere Austria Dataset API v1, Basis `https://dataset.api.hub.geosphere.at/v1`, kein API-Key. Stationsliste+Koordinaten: `GET /v1/station/historical/klima-v2-1d/metadata`. Werte: `GET /v1/timeseries/historical/klima-v2-1d?parameters=…&start=…&end=…&station_ids=…&output_format=geojson`. Datensätze: `klima-v2-1d` (täglich), `klima-v2-1m` (monatlich), `tawes-v1-10min` (aktuell).
>
> **Wichtig — genau so bauen:** Eine Kartenansicht ist **ein** Bulk-Request über *alle* Stationen (nicht pro Punkt), und historische Daten werden **dauerhaft gecacht**. Lies die verfügbaren Parameter aus `/metadata` und führe sie in einer Parameter-Registry. Nutze die `dataviz`-Skill für Farben/Legenden. Arbeite dann die Roadmap Schritt 1→6 in vertikalen Slices ab, committe und fasse nach jedem Schritt zusammen.

---

### Einzel-Prompts

**→ Schritt 1:** „Zieh die GeoSphere-Stationsstammdaten via `/v1/station/historical/klima-v2-1d/metadata`, leg `stations.json` (id, name, lat, lon, höhe, zeitraum, parameters) an und stell `/api/at/stations` und `/api/at/parameters` bereit. Prüfe: ~250–280 Stationen, Koordinaten in Österreich. Committen + zusammenfassen."

**→ Schritt 2:** „Rendere eine statische Österreich-Karte (Grenz-GeoJSON) mit allen Stationen als Punkte per Lat/Lon, Hover-Tooltip mit Name/Höhe. Noch keine Werte. Committen + zusammenfassen."

**→ Schritt 3:** „Führe eine Parameter-Registry ein und baue `/api/at/map?param=&when=&agg=` als **einen** Bulk-Request über alle Stationen; färbe die Stationen ein, füge Dropdown + Colorbar/Legende hinzu (dataviz-Skill), cache persistent. Committen + zusammenfassen."

**→ Schritt 4:** „Klick auf eine Station öffnet ein Detailpanel mit Zeitreihe/Meteogramm (bestehende Komponente, Quelle GeoSphere), Klimamittel und Rekorden. Committen + zusammenfassen."

**→ Schritt 5:** „Berechne langjährige Mittel (1991–2020) und Rekorde je Station vor, ergänze Dropdown-Optionen ‚Abweichung vom Mittel' (divergierende Colormap) und ‚Rekorde'. Committen + zusammenfassen."

**→ Schritt 6:** „Feinschliff: Caching prüfen (eine Auswahl = ein GeoSphere-Request, Wiederholung = 0), Ladezustände, Unit-Tests für Einheiten/Anomalien/Rekorde, 1–2 Visual-Checks. Abnahmekriterien abarbeiten und Stand melden."
