/**
 * heatmap.js — Leaflet.heat layer for company density.
 *
 * Generates a heatmap weighted by company count, revenue,
 * or IT spend at each coordinate point.
 */

import { getL } from './layers.js';
import { getCoords } from './cityCoords.js';

export class HeatmapLayer {
  constructor(map) {
    this._map = map;
    this._layer = null;
    this._options = {
      radius: 25,
      blur: 20,
      maxZoom: 12,
      max: 1.0,
      gradient: {
        0.2: '#2563EB',
        0.4: '#06B6D4',
        0.6: '#10B981',
        0.8: '#F59E0B',
        1.0: '#EF4444',
      },
    };
  }

  render(records, weightField) {
    this.remove();
    const L = getL();
    if (!L.heatLayer) return;

    const points = [];
    let maxWeight = 1;

    for (const rec of records) {
      const [lat, lng] = getCoords(rec.hqCity, rec.state);
      let weight = 1;

      if (weightField === 'revenue' && rec.revenue) {
        weight = rec.revenue;
      } else if (weightField === 'itSpend' && rec.itSpend) {
        weight = rec.itSpend;
      } else if (weightField === 'employees' && rec.employeeCount) {
        weight = rec.employeeCount;
      }

      if (weight > maxWeight) maxWeight = weight;
      points.push([lat, lng, weight]);
    }

    // Normalize weights to 0–1 range
    const normalized = points.map(([lat, lng, w]) => [lat, lng, w / maxWeight]);

    this._layer = L.heatLayer(normalized, this._options);
    this._layer.addTo(this._map);
  }

  remove() {
    if (this._layer) {
      this._map.removeLayer(this._layer);
      this._layer = null;
    }
  }

  setOptions(opts) {
    Object.assign(this._options, opts);
    if (this._layer) this._layer.setOptions(this._options);
  }
}
