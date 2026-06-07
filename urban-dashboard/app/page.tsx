'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Map as MapIcon, Settings2, MessageSquare, Send, Bike, Car, Layers, Search, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  api, NbRow, NbDetail, Meta, Scenario, PredictResult, Bikeshed,
  QUADRANT_META, AMENITY_LABELS, Quadrant,
} from '../lib/api';
import type { ColorMode } from '../components/MapComponent';

const MapComponent = dynamic(() => import('../components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-slate-50 text-gray-400">
      Loading map…
    </div>
  ),
});

const pct = (x: number | null | undefined, d = 0) =>
  x === null || x === undefined ? '—' : `${(x * 100).toFixed(d)}%`;

export default function Dashboard() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<Map<string, NbRow>>(new Map());

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<NbDetail | null>(null);
  const [bikeshed, setBikeshed] = useState<Bikeshed | null>(null);

  const [colorMode, setColorMode] = useState<ColorMode>('access-usage');
  const [selectedAmenity, setSelectedAmenity] = useState('groceries');
  const [query, setQuery] = useState('');
  // pan/zoom the map only for off-map selections (search/agent/clear),
  // never for a direct map click (which would slide the map out from under the cursor)
  const [autoPan, setAutoPan] = useState(false);

  const [scenario, setScenario] = useState<Scenario>({
    add_schools: 0, add_groceries: 0, add_healthcare: 0,
    accessibility_pct: 0, model: 'logistic_regression',
  });
  const [predict, setPredict] = useState<PredictResult | null>(null);
  const [predicting, setPredicting] = useState(false);

  // AI agent
  const [chatInput, setChatInput] = useState('');
  const [chat, setChat] = useState<{ role: 'user' | 'agent'; text: string }[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- load base data --------------------------------------------------------
  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
    api.neighborhoods()
      .then((arr) => setRows(new Map(arr.map((r) => [r.buurtcode, r]))))
      .catch(() => {});
  }, []);

  // --- selection -> detail + bike-shed ---------------------------------------
  useEffect(() => {
    if (!selectedCode) {
      setDetail(null);
      setBikeshed(null);
      setPredict(null);
      return;
    }
    api.neighborhood(selectedCode).then(setDetail).catch(() => {});
    api.bikeshed(selectedCode).then(setBikeshed).catch(() => setBikeshed(null));
  }, [selectedCode]);

  // click a neighbourhood to select it; click it again to deselect (no auto-pan)
  const toggleSelect = (code: string) => {
    setAutoPan(false);
    setSelectedCode((prev) => (prev === code ? null : code));
  };
  // off-map selection (search / agent): pan the map to it
  const selectAndPan = (code: string) => {
    setAutoPan(true);
    setSelectedCode(code);
  };
  const clearSelection = () => {
    setAutoPan(true);
    setSelectedCode(null);
  };

  // --- scenario -> prediction (debounced) ------------------------------------
  useEffect(() => {
    if (!selectedCode) { setPredict(null); return; }
    setPredicting(true);
    const t = setTimeout(() => {
      api.predict(selectedCode, scenario)
        .then(setPredict)
        .catch(() => setPredict(null))
        .finally(() => setPredicting(false));
    }, 350);
    return () => clearTimeout(t);
  }, [selectedCode, scenario]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, isTyping]);

  // Esc clears the current selection so you can explore another area
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rowsArr = useMemo(() => Array.from(rows.values()), [rows]);

  // Modelled p_bike has a narrow, model-specific spread (~0.2–0.44). Stretch the
  // colour ramp to the data's 5th–95th percentile so the choropleth shows real
  // contrast instead of a flat red/amber wash.
  const pbikeDomain = useMemo<[number, number]>(() => {
    const vals = rowsArr
      .map((r) => r.p_bike)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    if (vals.length < 20) return [0.2, 0.45];
    const q = (p: number) => vals[Math.floor(p * (vals.length - 1))];
    return [q(0.05), q(0.95)];
  }, [rowsArr]);
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return rowsArr
      .filter((r) => r.name.toLowerCase().includes(q) || r.gemeente.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, rowsArr]);

  // Essential Function Audit: underserved neighbourhoods for current category
  const underserved = useMemo(() => {
    if (colorMode !== 'amenity') return [];
    return rowsArr
      .filter((r) => (r[`amen_${selectedAmenity}`] as number | null) !== null)
      .sort((a, b) => (a[`amen_${selectedAmenity}`] as number) - (b[`amen_${selectedAmenity}`] as number))
      .slice(0, 6);
  }, [rowsArr, colorMode, selectedAmenity]);

  // --- AI agent --------------------------------------------------------------
  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput;
    setChat((p) => [...p, { role: 'user', text: msg }]);
    setChatInput('');
    setIsTyping(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: chat,
          dashboardState: {
            selected: detail,
            bikeshed,
            prediction: predict,
            scenario,
            colorMode,
            selectedAmenity,
          },
        }),
      });
      const data = await res.json();
      if (data.action?.type === 'updateScenario') {
        setScenario((p) => ({ ...p, ...data.action.payload }));
      }
      if (data.action?.type === 'selectNeighborhood' && data.action.payload?.buurtcode) {
        selectAndPan(data.action.payload.buurtcode);
      }
      const reply =
        (typeof data?.text === 'string' && data.text) ||
        (res.ok ? 'I could not produce a response.' : 'The assistant is unavailable right now. Please try again.');
      setChat((p) => [...p, { role: 'agent', text: reply }]);
    } catch {
      setChat((p) => [...p, { role: 'agent', text: 'Connection error reaching the assistant.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  // Quadrant is only meaningful when we actually have an ODiN usage sample;
  // without one the access×usage classification is undefined (the map greys it).
  const q = detail && detail.usage_share !== null ? QUADRANT_META[detail.quadrant as Quadrant] : null;

  return (
    <div className="min-h-screen bg-gray-50 p-4 lg:p-6 font-sans text-gray-900">
      <header className="mb-4">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Urban Equity Dashboard</h1>
        <p className="text-gray-500 text-sm">
          10-Minute Bike-Shed · Access–Usage Synthesis · Model-Driven Policy Simulator
          {meta && <span className="ml-2 text-gray-400">({meta.n_buurten.toLocaleString()} neighbourhoods)</span>}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* LEFT: map + audit + scenario */}
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
          {/* Feature 1: Access-Usage Heatmap */}
          <section className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <MapIcon className="w-5 h-5 text-blue-600" /> Access–Usage Heatmap
              </div>
              {detail && (
                <button
                  onClick={clearSelection}
                  title="Clear selection and zoom out (Esc)"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                >
                  Exploring: <span className="font-semibold">{detail.name}</span>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="ml-auto flex items-center gap-1 text-xs">
                {([
                  ['access-usage', 'Access × Usage'],
                  ['amenity', 'Amenity audit'],
                  ['pbike', 'Cycling propensity'],
                ] as [ColorMode, string][]).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setColorMode(m)}
                    className={`px-2.5 py-1 rounded-md border ${
                      colorMode === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* search */}
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search neighbourhood or municipality…"
                className="w-full pl-8 pr-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-[1000] mt-1 w-full bg-white border rounded-md shadow-lg max-h-56 overflow-y-auto">
                  {searchResults.map((r) => (
                    <button
                      key={r.buurtcode}
                      onClick={() => { selectAndPan(r.buurtcode); setQuery(''); }}
                      className="block w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50"
                    >
                      {r.name} <span className="text-gray-400">· {r.gemeente}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-full h-[420px] z-0 relative rounded-lg border-2 border-slate-200 overflow-hidden">
              <MapComponent
                rows={rows}
                colorMode={colorMode}
                pbikeDomain={pbikeDomain}
                selectedAmenity={selectedAmenity}
                selectedCode={selectedCode}
                bikeshed={bikeshed}
                autoPan={autoPan}
                onSelect={toggleSelect}
              />
            </div>

            {/* legend */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
              {colorMode === 'access-usage' &&
                (Object.entries(QUADRANT_META) as [Quadrant, typeof QUADRANT_META[Quadrant]][]).map(
                  ([k, v]) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm" style={{ background: v.color }} />
                      {v.label}
                    </span>
                  ),
                )}
              {colorMode === 'amenity' && (
                <>
                  <span className="font-medium">Category:</span>
                  {meta?.amenity_groups.map((g) => (
                    <button
                      key={g}
                      onClick={() => setSelectedAmenity(g)}
                      className={`px-2 py-0.5 rounded ${
                        selectedAmenity === g ? 'bg-emerald-600 text-white' : 'bg-gray-100'
                      }`}
                    >
                      {AMENITY_LABELS[g] ?? g}
                    </button>
                  ))}
                  <span className="ml-2 flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} /> under-served
                    <span className="w-3 h-3 rounded-sm ml-1" style={{ background: '#16a34a' }} /> well-served
                  </span>
                </>
              )}
              {colorMode === 'pbike' && (
                <span className="flex items-center gap-1">
                  Modelled cycling propensity:
                  <span className="w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} /> low ({pct(pbikeDomain[0], 0)})
                  <span className="w-3 h-3 rounded-sm" style={{ background: '#16a34a' }} /> high ({pct(pbikeDomain[1], 0)})
                </span>
              )}
              <span className="text-gray-400">· grey = no ODiN usage sample · dashed ring = 3 km bike-shed</span>
            </div>
          </section>

          {/* Feature 2 + 3: audit detail & what-if */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
            {/* selected neighbourhood / audit */}
            <section className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center gap-2 mb-3 font-semibold">
                <Layers className="w-5 h-5 text-emerald-600" /> Neighbourhood & Function Audit
              </div>
              {!detail ? (
                <p className="text-sm text-gray-400">Click a neighbourhood on the map or search above. Click another to switch; press <kbd className="px-1 border rounded">Esc</kbd> or the ✕ chip to clear.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="font-semibold text-base">{detail.name}
                    <span className="text-gray-400 font-normal"> · {detail.gemeente}</span>
                  </div>
                  {q ? (
                    <span className="inline-block text-xs px-2 py-0.5 rounded-full text-white" style={{ background: q.color }}>
                      {q.label}
                    </span>
                  ) : (
                    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                      No ODiN usage sample — quadrant n/a
                    </span>
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
                    <Stat label="10-min access (amenities)" value={detail.access_index?.toFixed(0) ?? '—'} />
                    <Stat label="Local cycling usage" value={pct(detail.usage_share, 1)} />
                    {/* Prefer the live PDP baseline (same engine as the what-if) so this
                        number matches the scenario builder below; fall back to the
                        precomputed value before the prediction loads. */}
                    <Stat label="Cycling propensity (model)" value={pct(predict?.baseline.p_bike ?? detail.p_bike, 1)} />
                    <Stat label="Elderly car-risk index" value={pct(predict?.baseline.car_risk ?? detail.car_risk, 0)} />
                    <Stat label="Population" value={detail.population?.toLocaleString() ?? '—'} />
                    <Stat label="Bike-shed buurten (3 km)" value={bikeshed?.n_members ?? '—'} />
                  </div>
                  <div className="pt-2">
                    <div className="text-xs text-gray-500 mb-1">Essential-function coverage (CBS proximity, 0–2+)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(detail.amenities).map(([k, v]) => (
                        <span
                          key={k}
                          className="text-xs px-2 py-0.5 rounded border"
                          style={{
                            borderColor: v === null ? '#e5e7eb' : v < 0.8 ? '#fca5a5' : v < 1.5 ? '#fcd34d' : '#86efac',
                            background: v === null ? '#f9fafb' : v < 0.8 ? '#fef2f2' : v < 1.5 ? '#fffbeb' : '#f0fdf4',
                          }}
                          title={`${AMENITY_LABELS[k] ?? k}: ${v ?? 'n/a'}`}
                        >
                          {AMENITY_LABELS[k] ?? k}: {v === null ? '—' : v.toFixed(1)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {colorMode === 'amenity' && underserved.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <div className="text-xs font-medium text-gray-600 mb-1">
                    Most under-served for {AMENITY_LABELS[selectedAmenity]}:
                  </div>
                  <ul className="text-xs text-gray-600 space-y-0.5">
                    {underserved.map((r) => (
                      <li key={r.buurtcode}>
                        <button className="hover:underline" onClick={() => selectAndPan(r.buurtcode)}>
                          {r.name} · {r.gemeente} ({(r[`amen_${selectedAmenity}`] as number).toFixed(1)})
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Feature 3: What-If */}
            <section className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center gap-2 mb-3 font-semibold">
                <Settings2 className="w-5 h-5 text-green-600" /> &quot;What-If&quot; Scenario Builder
              </div>
              {!selectedCode ? (
                <p className="text-sm text-gray-400">Select a neighbourhood to simulate interventions.</p>
              ) : (
                <>
                  <div className="space-y-3">
                    <Slider label="Add grocery stores" v={scenario.add_groceries} min={0} max={5}
                      onChange={(v) => setScenario((p) => ({ ...p, add_groceries: v }))} />
                    <Slider label="Add schools" v={scenario.add_schools} min={0} max={5}
                      onChange={(v) => setScenario((p) => ({ ...p, add_schools: v }))} />
                    <Slider label="Add healthcare facilities" v={scenario.add_healthcare} min={0} max={5}
                      onChange={(v) => setScenario((p) => ({ ...p, add_healthcare: v }))} />
                    <Slider label="Accessibility / bike-lane boost" v={scenario.accessibility_pct} min={0} max={100} step={10} suffix="%"
                      onChange={(v) => setScenario((p) => ({ ...p, accessibility_pct: v }))} />
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">Model:</span>
                      <select
                        value={scenario.model}
                        onChange={(e) => setScenario((p) => ({ ...p, model: e.target.value }))}
                        className="border rounded px-1.5 py-0.5"
                      >
                        {meta?.models.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <button
                        onClick={() => setScenario({ add_schools: 0, add_groceries: 0, add_healthcare: 0, accessibility_pct: 0, model: scenario.model })}
                        className="ml-auto text-gray-400 hover:text-gray-700"
                      >reset</button>
                    </div>
                  </div>

                  {predict && (
                    <div className="mt-4 pt-3 border-t space-y-2">
                      <ResultRow icon={<Bike className="w-4 h-4 text-green-600" />} label="Cycling propensity"
                        base={predict.baseline.p_bike} now={predict.scenario_result.p_bike} fmt={(x) => pct(x, 1)} up />
                      <ResultRow icon={<Car className="w-4 h-4 text-red-500" />} label="Elderly car-risk"
                        base={predict.baseline.car_risk} now={predict.scenario_result.car_risk} fmt={(x) => pct(x, 0)} up={false} />
                      <ResultRow label="Amenity gap"
                        base={predict.baseline.amenity_gap} now={predict.scenario_result.amenity_gap} fmt={(x) => x.toFixed(1)} up={false} />
                      {predict.assumptions.length > 0 && (
                        <details className="text-xs text-gray-500">
                          <summary className="cursor-pointer">Model assumptions</summary>
                          <ul className="list-disc ml-4 mt-1">
                            {predict.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                          </ul>
                          <p className="mt-1 italic">{predict.note}</p>
                        </details>
                      )}
                    </div>
                  )}
                  {predicting && <div className="mt-2 text-xs text-gray-400 animate-pulse">Running model…</div>}
                </>
              )}
            </section>
          </div>
        </div>

        {/* RIGHT: AI agent */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-7rem)] sticky top-6">
          <div className="p-4 border-b bg-gray-50 rounded-t-xl flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold">Policy Assistant (Gemini)</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chat.length === 0 ? (
              <div className="text-gray-400 text-sm mt-6 space-y-2">
                <p>I read live model output for the selected neighbourhood. Try:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>&quot;Explain this neighbourhood&apos;s access–usage gap.&quot;</li>
                  <li>&quot;What if we add 3 grocery stores here?&quot;</li>
                  <li>&quot;Compare adding schools vs improving accessibility.&quot;</li>
                  <li>&quot;Give me a policy recommendation.&quot;</li>
                </ul>
              </div>
            ) : (
              chat.map((m, i) => (
                <div key={i} className={`p-3 rounded-lg text-sm ${m.role === 'user' ? 'bg-blue-50 text-blue-900 ml-6' : 'bg-gray-100 text-gray-800 mr-6'}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              ))
            )}
            {isTyping && <div className="text-gray-400 text-sm animate-pulse mr-6 bg-gray-50 p-3 rounded-lg">Analysing…</div>}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={sendChat} className="p-3 border-t flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={detail ? `Ask about ${detail.name}…` : 'Select a neighbourhood, then ask…'}
              className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
            />
            <button type="submit" disabled={isTyping}
              className="bg-purple-600 text-white p-2 rounded-md hover:bg-purple-700 disabled:opacity-50">
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-gray-400 text-[11px] leading-tight">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Slider({ label, v, min, max, step = 1, suffix = '', onChange }: {
  label: string; v: number; min: number; max: number; step?: number; suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span><span className="font-semibold">{v}{suffix}</span>
      </label>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full cursor-pointer accent-green-600" />
    </div>
  );
}

function ResultRow({ icon, label, base, now, fmt, up }: {
  icon?: React.ReactNode; label: string; base: number; now: number;
  fmt: (x: number) => string; up: boolean;
}) {
  const delta = now - base;
  const good = up ? delta > 0 : delta < 0;
  const neutral = Math.abs(delta) < 1e-4;
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-gray-600">{label}</span>
      <span className="ml-auto tabular-nums">{fmt(base)} → <strong>{fmt(now)}</strong></span>
      <span className={`text-xs tabular-nums w-14 text-right ${neutral ? 'text-gray-400' : good ? 'text-green-600' : 'text-red-500'}`}>
        {neutral ? '±0' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}
      </span>
    </div>
  );
}
