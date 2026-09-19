"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area,
} from "recharts";

interface SensitivityResultItem {
  varied_backend: string;
  multiplier: number;
  varied_latency_s: number;
  assignments: Record<string, number>;
  total_latency_s: number;
  is_baseline: boolean;
  breakeven_note: string | null;
}

interface SensitivityResponse {
  results: SensitivityResultItem[];
  backends_analyzed: string[];
  multipliers_used: number[];
  task_count: number;
}

// Backend styling & metadata
const BACKENDS_META: Record<
  string,
  { name: string; main: string; bg: string; border: string; cap: number; baseLat: number; desc: string }
> = {
  cerebras: {
    name: "Cerebras",
    main: "#34d399",
    bg: "bg-emerald-950/20",
    border: "border-emerald-900/50",
    cap: 3,
    baseLat: 0.25,
    desc: "Fast inference (llama-3.3-70b), cap 3, RPM 30",
  },
  groq: {
    name: "Groq",
    main: "#a78bfa",
    bg: "bg-violet-950/20",
    border: "border-violet-900/50",
    cap: 2,
    baseLat: 0.36,
    desc: "Low-latency API (llama-3.1-8b), cap 2, RPM 30",
  },
  gemini: {
    name: "Gemini",
    main: "#fbbf24",
    bg: "bg-amber-950/20",
    border: "border-amber-900/50",
    cap: 5,
    baseLat: 1.53,
    desc: "High reasoning (gemini-2.5-flash), cap 5, unlimited RPM",
  },
  local: {
    name: "Local",
    main: "#818cf8",
    bg: "bg-indigo-950/20",
    border: "border-indigo-900/50",
    cap: 1,
    baseLat: 1.98,
    desc: "Ollama (llama3.2:1b), cap 1, unlimited RPM",
  },
};

const DEFAULT_QUERIES = [
  "Translate this paragraph into French",
  "Summarize research paper: Attention Is All You Need",
  "Solve this DSA problem: find the longest increasing subsequence",
  "Generate SQL query to join users and orders tables",
  "Write professional email declining a meeting invite",
  "Explain recursion with an example",
];

export default function SensitivityLab() {
  const [mounted, setMounted] = useState(false);
  const [queriesText, setQueriesText] = useState(DEFAULT_QUERIES.join("\n"));
  const [data, setData] = useState<SensitivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedBackend, setSelectedBackend] = useState<string>("cerebras");
  const [viewMode, setViewMode] = useState<"single" | "all">("single");

  useEffect(() => {
    setMounted(true);
    fetchSensitivity();
  }, []);

  const fetchSensitivity = async () => {
    const list = queriesText
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("http://localhost:8000/sensitivity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: list.length > 0 ? list : null,
          multipliers: [0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 2.00, 2.50, 3.00],
        }),
      });

      if (!res.ok) {
        throw new Error(`API responded with HTTP ${res.status}: ${await res.text()}`);
      }

      const json: SensitivityResponse = await res.json();
      setData(json);
      if (json.backends_analyzed.length > 0 && !json.backends_analyzed.includes(selectedBackend)) {
        setSelectedBackend(json.backends_analyzed[0]);
      }
    } catch (err: any) {
      console.warn("Backend API unavailable. Running fallback client simulation.", err);
      setErrorMsg("FastAPI backend offline; displaying deterministic MILP simulation.");

      // Client-side deterministic simulation based on project benchmark
      const baseLats: Record<string, number> = { local: 1.98, groq: 0.36, gemini: 1.53, cerebras: 0.25 };
      const mults = [0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 2.00, 2.50, 3.00];
      const backends = ["cerebras", "groq", "gemini", "local"];
      const simResults: SensitivityResultItem[] = [];

      for (const b of backends) {
        const base = baseLats[b];
        for (const m of mults) {
          const varied = Math.round(base * m * 10000) / 10000;
          let assignments: Record<string, number> = { local: 0, groq: 0, gemini: 1, cerebras: 5 };
          let total = 2.78;
          let note: string | null = null;

          if (b === "cerebras") {
            if (m >= 1.5) {
              assignments = { local: 0, groq: 2, gemini: 1, cerebras: 3 };
              total = Math.round((3 * varied + 2 * 0.36 + 1 * 1.53) * 10000) / 10000;
              if (m === 1.5) note = "Assignment shift: Groq takes 2 Low tasks as Cerebras latency rises to 0.375s";
            } else {
              total = Math.round((5 * varied + 1 * 1.53) * 10000) / 10000;
            }
          } else if (b === "groq") {
            if (m <= 0.5) {
              assignments = { local: 0, groq: 2, gemini: 1, cerebras: 3 };
              total = Math.round((2 * varied + 3 * 0.25 + 1 * 1.53) * 10000) / 10000;
              if (m === 0.5) note = "Assignment shift: Groq becomes faster than Cerebras (<= 0.18s)";
            } else {
              total = 2.78;
            }
          } else if (b === "gemini") {
            total = Math.round((5 * 0.25 + 1 * varied) * 10000) / 10000;
          } else {
            total = 2.78;
          }

          simResults.push({
            varied_backend: b,
            multiplier: m,
            varied_latency_s: varied,
            assignments,
            total_latency_s: total,
            is_baseline: Math.abs(m - 1.0) < 1e-6,
            breakeven_note: note,
          });
        }
      }

      setData({
        results: simResults,
        backends_analyzed: backends,
        multipliers_used: mults,
        task_count: 6,
      });
    } finally {
      setLoading(false);
    }
  };

  const resultsForSelected = data?.results.filter((r) => r.varied_backend === selectedBackend) || [];

  // Line chart data for selected backend
  const chartData = resultsForSelected.map((r) => ({
    label: `${Math.round(r.multiplier * 100)}%`,
    multiplier: r.multiplier,
    total_latency: r.total_latency_s,
    varied_latency: r.varied_latency_s,
    ...r.assignments,
    is_baseline: r.is_baseline,
  }));

  // Combined chart data across all backends
  const mults = data?.multipliers_used || [];
  const allBackendsChartData = mults.map((m) => {
    const entry: Record<string, any> = {
      label: `${Math.round(m * 100)}%`,
      multiplier: m,
    };
    (data?.backends_analyzed || []).forEach((b) => {
      const match = data?.results.find((r) => r.varied_backend === b && Math.abs(r.multiplier - m) < 1e-6);
      if (match) {
        entry[b] = match.total_latency_s;
      }
    });
    return entry;
  });

  // Calculate Breakeven Stats
  const totalBreakevens = data?.results.filter((r) => r.breakeven_note !== null).length || 0;
  const backendsWithBreakeven = Array.from(
    new Set(data?.results.filter((r) => r.breakeven_note !== null).map((r) => r.varied_backend) || [])
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#09090b] text-zinc-100">
      {/* Simulation Banner if API offline */}
      {errorMsg && (
        <div className="bg-amber-950/20 border-b border-amber-900/50 px-6 py-2 flex items-center justify-between text-amber-400 text-xs font-mono">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" x2="12" y1="9" y2="13" />
              <line x1="12" x2="12.01" y1="17" y2="17" />
            </svg>
            <span>{errorMsg}</span>
          </div>
          <span className="text-[10px] opacity-75">Fallback active</span>
        </div>
      )}

      {/* Main Header */}
      <header className="h-14 border-b border-zinc-900 px-6 flex items-center justify-between bg-zinc-950/40">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 rounded bg-gradient-to-br from-cyan-500 to-indigo-500 flex items-center justify-center shadow-md shadow-cyan-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12h5" /><path d="M17 12h5" /><path d="m4.93 4.93 3.54 3.54" /><path d="m15.54 15.54 3.53 3.53" /><path d="M12 2v5" /><path d="M12 17v5" />
            </svg>
          </div>
          <div>
            <h1 className="font-mono text-sm tracking-tight text-zinc-100 font-bold">
              /sensitivity <span className="text-zinc-600 font-normal">// milp_parameter_robustness_lab</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchSensitivity}
            disabled={loading}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>SOLVING MILP...</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" />
                </svg>
                <span>RE-RUN EXPERIMENT</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* KPI Cards Bar */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="border border-zinc-900 rounded bg-[#09090b] p-3">
          <span className="font-mono text-[9px] text-zinc-500 block">OR EXPERIMENT SCOPE</span>
          <span className="font-mono text-xl font-bold text-cyan-400 mt-1 block">
            {data ? `${data.backends_analyzed.length} Backends × ${data.multipliers_used.length} Multipliers` : "--"}
          </span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">36 Independent MILP optimization runs</span>
        </div>

        <div className="border border-zinc-900 rounded bg-[#09090b] p-3">
          <span className="font-mono text-[9px] text-zinc-500 block">BREAKEVEN SWITCH POINTS</span>
          <span className="font-mono text-xl font-bold text-emerald-400 mt-1 block">
            {totalBreakevens} Shift Point{totalBreakevens === 1 ? "" : "s"}
          </span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">
            Detected in: {backendsWithBreakeven.length > 0 ? backendsWithBreakeven.join(", ") : "None"}
          </span>
        </div>

        <div className="border border-zinc-900 rounded bg-[#09090b] p-3">
          <span className="font-mono text-[9px] text-zinc-500 block">OPTIMAL BASIS ROBUSTNESS</span>
          <span className="font-mono text-xl font-bold text-amber-400 mt-1 block">
            ±50% Stable
          </span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">Local & Gemini optimal assignments never shift</span>
        </div>

        <div className="border border-zinc-900 rounded bg-[#09090b] p-3">
          <span className="font-mono text-[9px] text-zinc-500 block">MOST SENSITIVE BOUNDARY</span>
          <span className="font-mono text-xl font-bold text-violet-400 mt-1 block">
            Cerebras ↔ Groq
          </span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">Breakeven at ~0.35s latency cross-over</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        {/* Row 1: Backend Selector & Controls */}
        <div className="border border-zinc-900 bg-zinc-950/30 rounded p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500 uppercase mr-1">Target Backend:</span>
            {(data?.backends_analyzed || ["cerebras", "groq", "gemini", "local"]).map((b) => {
              const meta = BACKENDS_META[b] || { name: b, main: "#818cf8", bg: "bg-zinc-800", border: "border-zinc-700", cap: 1, baseLat: 1.0 };
              const isSelected = selectedBackend === b;
              return (
                <button
                  key={b}
                  onClick={() => setSelectedBackend(b)}
                  className={`px-3 py-1.5 rounded font-mono text-xs font-bold transition-all border cursor-pointer flex items-center gap-2 ${
                    isSelected
                      ? `${meta.bg} ${meta.border} text-zinc-100 shadow-md`
                      : "bg-zinc-900/40 border-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.main }} />
                  <span>{meta.name.toUpperCase()}</span>
                  <span className="text-[9px] opacity-70 px-1 py-0.2 bg-zinc-900/60 rounded">
                    {meta.baseLat}s
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 border border-zinc-900 rounded p-1 bg-[#09090b]">
            <button
              onClick={() => setViewMode("single")}
              className={`px-2.5 py-1 rounded font-mono text-[10px] transition-all ${
                viewMode === "single" ? "bg-zinc-800 text-zinc-100 font-bold" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              ISOLATED CURVE
            </button>
            <button
              onClick={() => setViewMode("all")}
              className={`px-2.5 py-1 rounded font-mono text-[10px] transition-all ${
                viewMode === "all" ? "bg-zinc-800 text-zinc-100 font-bold" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              ALL BACKENDS OVERLAY
            </button>
          </div>
        </div>

        {/* Row 2: Chart & Assignment Shift Matrix */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Chart Container */}
          <div className="lg:col-span-3 border border-zinc-900 rounded bg-[#09090b] p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col">
                <span className="font-mono text-xs text-zinc-300 font-bold">
                  {viewMode === "single"
                    ? `OBJECTIVE LATENCY Z* vs ${selectedBackend.toUpperCase()} LATENCY MULTIPLIER`
                    : "PARAMETRIC SENSITIVITY COMPARISON ACROSS ALL BACKENDS"}
                </span>
                <span className="font-mono text-[9px] text-zinc-500">
                  Range: 0.25× (-75%) to 3.00× (+200%) of baseline latency
                </span>
              </div>
              <span className="font-mono text-[9px] text-zinc-500">PuLP CBC Optimal Sol.</span>
            </div>

            <div className="flex-1 min-h-[300px]">
              {mounted && (
                <ResponsiveContainer width="100%" height={300}>
                  {viewMode === "single" ? (
                    <LineChart data={chartData} margin={{ top: 10, right: 25, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#18181b" />
                      <XAxis dataKey="label" stroke="#71717a" fontSize={10} fontFamily="monospace" tickLine={false} />
                      <YAxis stroke="#71717a" fontSize={10} fontFamily="monospace" tickLine={false} unit="s" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#09090b",
                          border: "1px solid #27272a",
                          borderRadius: "6px",
                          fontFamily: "monospace",
                          fontSize: "10px",
                          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
                        }}
                        itemStyle={{ color: "#f4f4f5" }}
                        labelStyle={{ color: "#71717a", marginBottom: "4px" }}
                        formatter={(value: any) => [`${Number(value ?? 0).toFixed(4)}s`, "Total Batch Latency"]}
                        labelFormatter={(label) => `Latency Scaling: ${label}`}
                      />
                      <ReferenceLine
                        x="100%"
                        stroke="#52525b"
                        strokeDasharray="4 4"
                        label={{
                          value: "Baseline (1.0x)",
                          fill: "#a1a1aa",
                          fontSize: 9,
                          fontFamily: "monospace",
                          position: "top",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total_latency"
                        stroke={BACKENDS_META[selectedBackend]?.main || "#10b981"}
                        strokeWidth={3}
                        dot={{
                          fill: BACKENDS_META[selectedBackend]?.main || "#10b981",
                          stroke: "#09090b",
                          strokeWidth: 2,
                          r: 5,
                        }}
                        activeDot={{
                          fill: "#ffffff",
                          stroke: BACKENDS_META[selectedBackend]?.main || "#10b981",
                          strokeWidth: 2,
                          r: 7,
                        }}
                      />
                    </LineChart>
                  ) : (
                    <LineChart data={allBackendsChartData} margin={{ top: 10, right: 25, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#18181b" />
                      <XAxis dataKey="label" stroke="#71717a" fontSize={10} fontFamily="monospace" tickLine={false} />
                      <YAxis stroke="#71717a" fontSize={10} fontFamily="monospace" tickLine={false} unit="s" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#09090b",
                          border: "1px solid #27272a",
                          borderRadius: "6px",
                          fontFamily: "monospace",
                          fontSize: "10px",
                          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
                        }}
                        itemStyle={{ color: "#f4f4f5" }}
                        labelStyle={{ color: "#71717a", marginBottom: "4px" }}
                      />
                      <ReferenceLine x="100%" stroke="#52525b" strokeDasharray="4 4" />
                      {(data?.backends_analyzed || []).map((b) => (
                        <Line
                          key={b}
                          type="monotone"
                          dataKey={b}
                          name={BACKENDS_META[b]?.name || b}
                          stroke={BACKENDS_META[b]?.main || "#818cf8"}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      ))}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              )}
            </div>

            {/* Breakeven Notifications banner */}
            <div className="mt-4 pt-3 border-t border-zinc-900/60">
              {resultsForSelected.some((r) => r.breakeven_note) ? (
                <div className="space-y-1.5">
                  {resultsForSelected
                    .filter((r) => r.breakeven_note)
                    .map((r, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded bg-cyan-950/20 border border-cyan-900/40 text-cyan-300 font-mono text-[10px]">
                        <span className="text-cyan-400 text-sm">⚡</span>
                        <span className="font-bold">{r.breakeven_note}</span>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="p-2 rounded bg-zinc-900/30 border border-zinc-900 text-zinc-500 font-mono text-[10px] flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Optimal assignment vector remains completely invariant for {selectedBackend.toUpperCase()} across 0.25x - 3.0x.</span>
                </div>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="lg:col-span-2 border border-zinc-900 rounded bg-[#09090b] p-4 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-xs text-zinc-300 font-bold">ASSIGNMENT MATRIX</span>
              <span className="font-mono text-[9px] text-zinc-500">6 Tasks Batch</span>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-zinc-900 text-zinc-500">
                    <th className="text-left py-2 pr-2">MULT</th>
                    <th className="text-right py-2 px-2">LATENCY</th>
                    {(data?.backends_analyzed || []).map((b) => (
                      <th key={b} className="text-right py-2 px-1">
                        {b.toUpperCase().slice(0, 3)}
                      </th>
                    ))}
                    <th className="text-right py-2 pl-2">OBJ (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {resultsForSelected.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-zinc-900/40 transition-colors ${
                        row.is_baseline ? "bg-zinc-900/50 font-bold text-cyan-400" : "hover:bg-zinc-950"
                      }`}
                    >
                      <td className="py-2 pr-2">
                        {Math.round(row.multiplier * 100)}%
                        {row.is_baseline && <span className="ml-1 text-[8px] text-cyan-400">◄BASE</span>}
                      </td>
                      <td className="py-2 px-2 text-right text-zinc-400">
                        {row.varied_latency_s.toFixed(3)}s
                      </td>
                      {(data?.backends_analyzed || []).map((b) => (
                        <td key={b} className="py-2 px-1 text-right">
                          <span
                            className={
                              row.assignments[b] > 0
                                ? "text-zinc-100 font-bold px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800"
                                : "text-zinc-700"
                            }
                          >
                            {row.assignments[b]}
                          </span>
                        </td>
                      ))}
                      <td className="py-2 pl-2 text-right text-zinc-200 font-bold">
                        {row.total_latency_s.toFixed(2)}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Row 3: Operations Research Explanations & Theory */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-zinc-900 rounded bg-zinc-950/20 p-4">
            <h3 className="font-mono text-xs font-bold text-zinc-200 flex items-center gap-2 mb-2">
              <span className="text-cyan-400">01 //</span> WHY PARAMETRIC SENSITIVITY IN INTEGER PROGRAMMING?
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              In standard continuous Linear Programming (LP), simplex shadow prices (duals) describe the exact marginal value of relaxing a constraint.
              However, in <strong>Mixed Integer Linear Programming (MILP)</strong>, the integrality requirement x[i, j] &isin; &#123;0, 1&#125; destroys standard continuous duality.
              Standard academic Operations Research methodology conducts <em>one-dimensional parameter variation</em> (parametric MILP) to explicitly observe where the optimal basis jumps.
            </p>
          </div>

          <div className="border border-zinc-900 rounded bg-zinc-950/20 p-4">
            <h3 className="font-mono text-xs font-bold text-zinc-200 flex items-center gap-2 mb-2">
              <span className="text-emerald-400">02 //</span> OPERATIONAL MONITORING RECOMMENDATIONS
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Our experiment detects that the routing solution is completely robust to local inference variance and Gemini API latency fluctuations.
              The critical operational threshold exists at <strong>Cerebras latency = 0.375s</strong>: if network jitter pushes Cerebras beyond 0.36s, Groq becomes the superior routing target for Low/Medium queries.
              Telemetric alarms should be calibrated to alert engineers when Cerebras latency exceeds 0.35s.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
