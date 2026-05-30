'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { NbRow, Quadrant, QUADRANT_META, Bikeshed } from '../lib/api';

export type ColorMode = 'access-usage' | 'amenity' | 'pbike';

interface Props {
  rows: Map<string, NbRow>;
  colorMode: ColorMode;
  selectedAmenity: string;
  selectedCode: string | null;
  bikeshed: Bikeshed | null;
  autoPan: boolean; // pan/zoom the map on selection change (search/agent/clear, not map clicks)
  onSelect: (code: string) => void;
}

// red -> amber -> green interpolation for continuous scales (t in 0..1)
function ramp(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [239, 68, 68],   // red
    [245, 158, 11],  // amber
    [22, 163, 74],   // green
  ];
  const seg = t < 0.5 ? 0 : 1;
  const lt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = stops[seg], b = stops[seg + 1];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * lt));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function colorFor(
  row: NbRow | undefined,
  mode: ColorMode,
  amenity: string,
): string {
  if (!row) return '#e5e7eb';
  if (mode === 'access-usage') {
    if (row.usage === null) return '#e5e7eb'; // no ODiN usage sample
    return QUADRANT_META[row.quadrant as Quadrant].color;
  }
  if (mode === 'pbike') {
    if (row.p_bike === null) return '#e5e7eb';
    // p_bike roughly 0.25..0.65 across NL -> stretch to 0..1
    return ramp((row.p_bike - 0.25) / 0.4);
  }
  // amenity audit: coverage class typically 0..2 (higher = better served)
  const v = row[`amen_${amenity}`] as number | null;
  if (v === null || v === undefined) return '#e5e7eb';
  return ramp(Math.min(v, 2) / 2);
}

/** Imperatively-managed GeoJSON layer (14k polygons, canvas renderer). */
function BuurtenLayer(props: Props) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const stateRef = useRef(props);
  stateRef.current = props;

  const styleFn = (feature?: L.GeoJSON.Feature): L.PathOptions => {
    const { rows, colorMode, selectedAmenity, selectedCode } = stateRef.current;
    const code = feature?.properties?.buurtcode as string;
    const selected = code === selectedCode;
    return {
      fillColor: colorFor(rows.get(code), colorMode, selectedAmenity),
      fillOpacity: 0.7,
      weight: selected ? 2.5 : 0.3,
      color: selected ? '#111827' : '#9ca3af',
    };
  };

  // load geometry once
  useEffect(() => {
    let cancelled = false;
    fetch('/buurten.geojson')
      .then((r) => r.json())
      .then((geo) => {
        if (cancelled) return;
        // One shared canvas renderer for the buurten AND the bike-shed ring.
        // (If the ring used the map's default renderer it would create a second
        //  canvas on top that swallows clicks meant for the buurten.)
        rendererRef.current = L.canvas({ padding: 0.5 });
        const layer = L.geoJSON(geo, {
          renderer: rendererRef.current,
          style: styleFn,
          onEachFeature: (feature, lyr) => {
            const code = feature.properties?.buurtcode as string;
            lyr.on('click', () => stateRef.current.onSelect(code));
            lyr.on('mouseover', () => (lyr as L.Path).bringToFront?.());
          },
        });
        layer.addTo(map);
        layer.bindTooltip(
          (lyr) => {
            const code = (lyr as L.Layer & { feature?: L.GeoJSON.Feature })
              .feature?.properties?.buurtcode as string;
            const r = stateRef.current.rows.get(code);
            return r ? `${r.name} · ${r.gemeente}` : code;
          },
          { sticky: true },
        );
        layerRef.current = layer;
      });
    return () => {
      cancelled = true;
      layerRef.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // restyle on mode / data / selection change
  useEffect(() => {
    layerRef.current?.setStyle(styleFn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.colorMode, props.selectedAmenity, props.selectedCode, props.rows]);

  // 3 km bike-shed ring; pan/zoom only when the change came from off the map
  const didInit = useRef(false);
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
    const bs = props.bikeshed;
    if (bs) {
      const center = L.latLng(bs.center[1], bs.center[0]);
      circleRef.current = L.circle(center, {
        radius: bs.radius_km * 1000,
        color: '#7c3aed',
        weight: 2,
        fill: false,
        dashArray: '6 6',
        interactive: false,           // never swallow clicks meant for the buurten
        renderer: rendererRef.current ?? undefined, // share the buurten canvas
      }).addTo(map);
      if (props.autoPan) map.setView(center, 13, { animate: false });
    } else if (!props.selectedCode && props.autoPan && didInit.current) {
      // selection cleared from the UI -> return to the national overview
      map.setView([52.1, 5.3], 8, { animate: false });
    }
    didInit.current = true;
  }, [props.bikeshed, props.selectedCode, props.autoPan, map]);

  return null;
}

export default function MapComponent(props: Props) {
  return (
    <MapContainer
      center={[52.1, 5.3]}
      zoom={8}
      preferCanvas
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <BuurtenLayer {...props} />
    </MapContainer>
  );
}
