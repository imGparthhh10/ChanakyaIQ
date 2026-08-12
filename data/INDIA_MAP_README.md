# India State Boundaries — Map File

The dashboard's India choropleth loads state boundaries from a GeoJSON file.
The default remote source uses UN-line boundaries, which are **not authoritative
for India** — Jammu & Kashmir, Ladakh, Aksai Chin, and Gilgit-Baltistan are
shown incorrectly.

## Current status

`data/india-states.geojson` is currently sourced from
[udit-001/india-maps-data](https://github.com/udit-001/india-maps-data)
(district-level, 760 features, 36 states/UTs). It distinguishes **Jammu and
Kashmir** from **Ladakh** as separate entities (the 2019 UT split) and uses
current names (Odisha, Uttarakhand, the merged Dadra & Nagar Haveli and Daman
& Diu UT). The J&K feature set includes Muzaffarabad and Mirpur districts
(Pakistan-administered Kashmir), and the Ladakh feature set's extent reaches
~80.3°E/37.1°N, covering the Aksai Chin area.

Verification performed: district-name and bounding-box structural checks
against known reference coordinates for these regions — **not** a full
authoritative cartographic audit against Survey of India source data, which
would be the proper final check before relying on this for anything beyond
an internal BFSI sales dashboard's choropleth coloring. The previous
36-feature single-polygon-per-state file (pre-2019 split, "Orissa"/
"Uttaranchal" naming) was kept at `data/india-states.geojson.bak` for
regression comparison; it was deleted 2026-08-12 after confirming the
760-feature replacement above renders correctly.

Being district-level rather than one-polygon-per-state, this file also
renders thin internal district borders within each state (choropleth.js
styles every feature independently, so this doesn't break state-level
coloring — it's a minor additional visual detail, not a defect). It's also
~4 MB vs. the old file's much smaller footprint — fetched once and cached
in-memory by `fetchIndiaStates()`, not re-fetched on every map interaction.

## To use the correct Government-of-India political map

Save a GeoJSON file at **one** of these paths (first found wins):

```
data/india-states.geojson    ← preferred
data/india_states.geojson
data/india.geojson
```

## Requirements for the file

- Must be a valid GeoJSON `FeatureCollection`
- Must have **at least 5 features** (states / UTs)
- Each feature's `properties` object should carry the state name under **any**
  of these keys — the loader tries them all:
  `NAME_1` · `name` · `ST_NM` · `st_nm` · `state` · `STATE` · `NAME` · `STATE_NAME` · `state_name`

Example feature shape:
```json
{
  "type": "Feature",
  "properties": { "NAME_1": "Jammu and Kashmir" },
  "geometry": { "type": "Polygon", "coordinates": [ ... ] }
}
```

## Where to get an official file

Any of these sources publish India GeoJSONs with Government-of-India boundaries.
Verify the boundaries match the political map before using in production:

- **Survey of India** (surveyofindia.gov.in) — official cartographic authority
- **MyGov India** open data portals
- **datameet/maps** (github.com/datameet/maps) — Indian civic-data community
- Commercial GIS vendors that license the Survey of India base map

## What happens if no file is present

The loader falls back to the remote UN-line source. This is functional but the
J&K / Ladakh / Aksai Chin regions will not appear correctly.

The console will log which source was used:

```
[layers] India states loaded from local source: data/india-states.geojson (36 features)
```

or

```
[layers] India states loaded from remote source: https://... (29 features)
```
