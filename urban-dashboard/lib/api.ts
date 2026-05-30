// Typed client for the FastAPI model backend.
export const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

export type Quadrant = 'success' | 'opportunity' | 'stretched' | 'underserved';

export interface NbRow {
  buurtcode: string;
  name: string;
  gemeente: string;
  access: number | null;
  usage: number | null;
  p_bike: number | null;
  car_risk: number | null;
  quadrant: Quadrant;
  amen_schools: number | null;
  amen_groceries: number | null;
  amen_healthcare: number | null;
  amen_childcare: number | null;
  amen_sports: number | null;
  amen_dining: number | null;
  amen_transport: number | null;
  [k: string]: unknown;
}

export interface NbDetail {
  buurtcode: string;
  name: string;
  gemeente: string;
  population: number | null;
  elderly_share: number | null;
  neighbourhood_type: string | null;
  access_index: number | null;
  usage_share: number | null;
  p_bike: number | null;
  car_risk: number | null;
  quadrant: Quadrant;
  bikeshed_utilitarian: number | null;
  bikeshed_leisure: number | null;
  amenities: Record<string, number | null>;
}

export interface Meta {
  n_buurten: number;
  access_median: number;
  usage_median: number;
  util_median: number;
  amenity_groups: string[];
  models: string[];
}

export interface Scenario {
  add_schools: number;
  add_groceries: number;
  add_healthcare: number;
  accessibility_pct: number;
  model: string;
}

export interface PredictResult {
  buurtcode: string;
  name: string;
  gemeente: string;
  model: string;
  assumptions: string[];
  baseline: { p_bike: number; car_risk: number; amenity_gap: number };
  scenario_result: { p_bike: number; car_risk: number; amenity_gap: number };
  delta: { p_bike: number; car_risk: number; access_gain: number };
  note: string;
}

export interface Bikeshed {
  buurtcode: string;
  center: [number, number]; // [lon, lat]
  radius_km: number;
  members: string[];
  n_members: number;
  shed_avg_access: number | null;
  shed_avg_usage: number | null;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export const api = {
  meta: () => j<Meta>(`${BACKEND}/api/meta`),
  neighborhoods: () => j<NbRow[]>(`${BACKEND}/api/neighborhoods`),
  neighborhood: (code: string) => j<NbDetail>(`${BACKEND}/api/neighborhood/${code}`),
  bikeshed: (code: string) => j<Bikeshed>(`${BACKEND}/api/bikeshed/${code}`),
  predict: (buurtcode: string, scenario: Scenario) =>
    j<PredictResult>(`${BACKEND}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buurtcode, scenario }),
    }),
};

// ---- shared display helpers -------------------------------------------------
export const QUADRANT_META: Record<Quadrant, { label: string; color: string; desc: string }> = {
  success: { label: 'Local-living success', color: '#16a34a', desc: 'Good access & high local cycling' },
  opportunity: { label: 'Policy opportunity', color: '#f59e0b', desc: 'Good access but low local cycling' },
  stretched: { label: 'Stretched', color: '#3b82f6', desc: 'Low access yet residents still cycle' },
  underserved: { label: 'Underserved', color: '#ef4444', desc: 'Low access & low cycling' },
};

export const AMENITY_LABELS: Record<string, string> = {
  schools: 'Schools',
  groceries: 'Groceries',
  healthcare: 'Healthcare',
  childcare: 'Childcare',
  sports: 'Sports',
  dining: 'Dining',
  transport: 'Transport',
};
