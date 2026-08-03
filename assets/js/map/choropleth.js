/**
 * choropleth.js — State-level choropleth layer.
 *
 * Colors Indian states by company count, revenue, or other metric.
 * Provides hover interaction with state info popup and integrates
 * with the legend control.
 */

import { bus } from '../utils/eventBus.js';
import { getL } from './layers.js';

// Canonical state names. Keys are lowercase, punctuation-stripped variants
// commonly seen in the wild (excel exports, GeoJSON property fields, older
// datasets that pre-date the 2019 J&K → J&K + Ladakh split, etc.).
const STATE_NAME_MAP = {
  // A & N Islands
  'andaman and nicobar':          'Andaman and Nicobar Islands',
  'andaman & nicobar':            'Andaman and Nicobar Islands',
  'andaman and nicobar islands':  'Andaman and Nicobar Islands',
  'a&n islands':                  'Andaman and Nicobar Islands',
  'a & n islands':                'Andaman and Nicobar Islands',

  'andhra pradesh':               'Andhra Pradesh',
  'ap':                           'Andhra Pradesh',

  'arunachal pradesh':            'Arunachal Pradesh',

  'assam':                        'Assam',

  'bihar':                        'Bihar',

  'chhattisgarh':                 'Chhattisgarh',
  'chattisgarh':                  'Chhattisgarh',
  'chhatisgarh':                  'Chhattisgarh',

  // Dadra & Nagar Haveli and Daman & Diu (merged UT since 2020)
  'dadra and nagar haveli':                       'Dadra and Nagar Haveli and Daman and Diu',
  'dadra & nagar haveli':                         'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu':                                'Dadra and Nagar Haveli and Daman and Diu',
  'daman & diu':                                  'Dadra and Nagar Haveli and Daman and Diu',
  'dadra and nagar haveli and daman and diu':     'Dadra and Nagar Haveli and Daman and Diu',
  'dnh and dd':                                   'Dadra and Nagar Haveli and Daman and Diu',

  // Delhi (NCT)
  'delhi':                        'Delhi',
  'new delhi':                    'Delhi',
  'nct of delhi':                 'Delhi',
  'nct delhi':                    'Delhi',
  'national capital territory':   'Delhi',

  'goa':                          'Goa',

  'gujarat':                      'Gujarat',
  'gujrat':                       'Gujarat',

  'haryana':                      'Haryana',

  'himachal pradesh':             'Himachal Pradesh',
  'hp':                           'Himachal Pradesh',

  // Jammu & Kashmir — every common variant
  'jammu and kashmir':            'Jammu and Kashmir',
  'jammu & kashmir':              'Jammu and Kashmir',
  'jammu kashmir':                'Jammu and Kashmir',
  'j&k':                          'Jammu and Kashmir',
  'j & k':                        'Jammu and Kashmir',
  'jk':                           'Jammu and Kashmir',
  'j and k':                      'Jammu and Kashmir',

  'jharkhand':                    'Jharkhand',
  'jharkand':                     'Jharkhand',

  'karnataka':                    'Karnataka',
  'karnatka':                     'Karnataka',

  'kerala':                       'Kerala',

  // Ladakh (UT since 2019)
  'ladakh':                       'Ladakh',
  'ladakh ut':                    'Ladakh',
  'ladakh (ut)':                  'Ladakh',

  'lakshadweep':                  'Lakshadweep',
  'lakshwadeep':                  'Lakshadweep',

  'madhya pradesh':               'Madhya Pradesh',
  'mp':                           'Madhya Pradesh',

  'maharashtra':                  'Maharashtra',
  'maharastra':                   'Maharashtra',

  'manipur':                      'Manipur',

  'meghalaya':                    'Meghalaya',

  'mizoram':                      'Mizoram',

  'nagaland':                     'Nagaland',

  'odisha':                       'Odisha',
  'orissa':                       'Odisha',

  'puducherry':                   'Puducherry',
  'pondicherry':                  'Puducherry',
  'pondichery':                   'Puducherry',

  'punjab':                       'Punjab',

  'rajasthan':                    'Rajasthan',
  'rajastan':                     'Rajasthan',

  'sikkim':                       'Sikkim',

  'tamil nadu':                   'Tamil Nadu',
  'tamilnadu':                    'Tamil Nadu',
  'tn':                           'Tamil Nadu',

  'telangana':                    'Telangana',
  'telengana':                    'Telangana',
  'ts':                           'Telangana',

  'tripura':                      'Tripura',

  'uttar pradesh':                'Uttar Pradesh',
  'up':                           'Uttar Pradesh',

  'uttarakhand':                  'Uttarakhand',
  'uttaranchal':                  'Uttarakhand',
  'uk':                           'Uttarakhand',

  'west bengal':                  'West Bengal',
  'wb':                           'West Bengal',
  'w bengal':                     'West Bengal',
  'w. bengal':                    'West Bengal',
  'bengal':                       'West Bengal',

  'chandigarh':                   'Chandigarh',
};

const COLOR_SCALE = [
  '#EEF2FF', '#C7D2FE', '#A5B4FC', '#818CF8',
  '#6366F1', '#4F46E5', '#4338CA', '#3730A3',
];

function getColor(value, max) {
  if (!value || !max) return COLOR_SCALE[0];
  const ratio = Math.min(value / max, 1);
  const idx = Math.min(Math.floor(ratio * (COLOR_SCALE.length - 1)), COLOR_SCALE.length - 1);
  return COLOR_SCALE[idx];
}

function normalizeStateName(name) {
  if (!name) return '';
  // Strip diacritics, collapse whitespace, kill punctuation noise
  const key = String(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,]/g, '');
  // Direct hit
  if (STATE_NAME_MAP[key]) return STATE_NAME_MAP[key];
  // Try again without "&" / "and" ambiguity
  const alt = key.replace(/\s*&\s*/g, ' and ');
  if (STATE_NAME_MAP[alt]) return STATE_NAME_MAP[alt];
  const alt2 = key.replace(/\s+and\s+/g, ' & ');
  if (STATE_NAME_MAP[alt2]) return STATE_NAME_MAP[alt2];
  return String(name).trim();
}

export class ChoroplethLayer {
  constructor(map) {
    this._map = map;
    this._L = getL();
    this._layer = null;
    this._info = null;
    this._stateData = {};
    this._metric = 'count';
    this._maxValue = 0;
  }

  setData(cache, metric = 'count') {
    this._metric = metric;
    this._stateData = {};

    const states = cache.states();
    for (const state of states) {
      const records = cache.getByState(state);
      if (metric === 'count') {
        this._stateData[state] = records.length;
      } else if (metric === 'revenue') {
        this._stateData[state] = records.reduce((s, r) => s + (r.revenue || 0), 0);
      } else if (metric === 'itSpend') {
        this._stateData[state] = records.reduce((s, r) => s + (r.itSpend || 0), 0);
      }
    }

    this._maxValue = Math.max(...Object.values(this._stateData), 1);
  }

  render(geojson) {
    if (!geojson) return;
    this.remove();

    this._layer = this._L.geoJSON(geojson, {
      style: (feature) => {
        const name = this._resolveStateName(feature);
        const value = this._stateData[name] || 0;
        return {
          fillColor: getColor(value, this._maxValue),
          weight: 1.5,
          opacity: 0.8,
          color: 'rgba(255,255,255,0.5)',
          dashArray: '',
          fillOpacity: 0.55,
        };
      },
      onEachFeature: (feature, layer) => {
        const name = this._resolveStateName(feature);
        const value = this._stateData[name] || 0;
        const label = this._metric === 'count' ? `${value} companies` :
                      `₹${value.toLocaleString('en-IN')} Cr`;

        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({ weight: 3, color: '#fff', fillOpacity: 0.75 });
            l.bringToFront();
            bus.emit('map:state-hover', { state: name, value, metric: this._metric });
          },
          mouseout: (e) => {
            this._layer.resetStyle(e.target);
          },
          click: (e) => {
            this._map.fitBounds(e.target.getBounds(), { padding: [20, 20] });
            bus.emit('map:state-click', { state: name, value, metric: this._metric });
          },
        });

        layer.bindTooltip(
          `<div class="esds-state-tooltip"><strong>${name}</strong><br/>${label}</div>`,
          { sticky: true, className: 'esds-leaflet-tooltip' }
        );
      },
    });

    this._layer.addTo(this._map);
  }

  remove() {
    if (this._layer) {
      this._map.removeLayer(this._layer);
      this._layer = null;
    }
  }

  _resolveStateName(feature) {
    const props = feature.properties || {};
    // Try every common property key that India GeoJSONs use for the state name
    const raw = props.NAME_1 || props.name || props.ST_NM || props.st_nm ||
                props.state || props.STATE || props.State ||
                props.NAME || props.Name || props.statename ||
                props.STATE_NAME || props.state_name ||
                props.STNAME || props.stname ||
                props.NAME_2 || props.district || '';
    return normalizeStateName(raw);
  }

  get colorScale() { return COLOR_SCALE; }
  get maxValue()   { return this._maxValue; }
  get metric()     { return this._metric; }
}
