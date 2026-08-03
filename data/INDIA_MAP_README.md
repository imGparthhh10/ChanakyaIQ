# India State Boundaries — Map File

The dashboard's India choropleth loads state boundaries from a GeoJSON file.
The default remote source uses UN-line boundaries, which are **not authoritative
for India** — Jammu & Kashmir, Ladakh, Aksai Chin, and Gilgit-Baltistan are
shown incorrectly.

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
