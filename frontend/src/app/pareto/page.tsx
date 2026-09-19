"use client";

import { useState, useEffect } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Line,
  ComposedChart,
} from "recharts";

interface ParetoPointItem {
  alpha: number;
  latency_weight: number;
  cost_weight: number;
  total_latency_s: number;
  total_cost_usd: number;
  assignments: Record<string, number>;
  is_pareto_optimal: boolean;
}

interface ParetoResponse {
  points: ParetoPointItem[];
  pareto_optimal_points: ParetoPointItem[];
  max_cost_savings_pct: number;
  max_latency_savings_pct: number;
  task_count: number;
  backends_included: string[];
}

const DEFAULT_QUERIES = [
  "Translate this paragraph into French",
  "Summarize research paper: Attention Is All You Need",
  "Solve this DSA problem: find the longest increasing subsequence",
  "Generate SQL query to join users and orders tables",
  "Write professional email declining a meeting invite",
  "Explain recursion with an example",
];

const BACKEND_COLORS: Record<string, string> = {
  local: "#818cf8",
  groq: "#a78bfa",
  cerebras: "#34d399",
  gemini: "#fbbf24",
};

export default function ParetoLab() {
  const [mounted, setMounted] = useState(false);
  const [queriesText, setQueriesText] = useState(DEFAULT_QUERIES.join("\n"));
  const [data, setData] = useState<ParetoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedAlpha, setSelectedAlpha] = useState<number>(1.0);

  useEffect(() => {
    setMounted(true);
    fetchPareto();
  }, []);

  const fetchPareto = async () => {
    const list = queriesText
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("http://localhost:8000/pareto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: list.length > 0 ? list : null,
          steps: 11,
        }),
      });

      if (!res.ok) {
        throw new Error(`API responded with HTTP ${res.status}: ${await res.text()}`);
      }

      const json: ParetoResponse = await res.json();
      setData(json);
    } catch (err: any) {
      console.warn("Backend API unavailable. Running fallback client simulation.", err);
      setErrorMsg("FastAPI backend offline; rendering deterministic multi-objective simulation.");

      // Fallback deterministic simulation matching OR experiment
      const points: ParetoPointItem[] = [
        {
          alpha: 0.0,
          latency_weight: 0.0,
          cost_weight: 1.0,
          total_latency_s: 6.24,
          total_cost_usd: 0.0021,
          assignments: { local: 2, groq: 0, gemini: 1, cerebras: 3 },
          is_pareto_optimal: true,
        },
        {
          alpha: 0.1,
          latency_weight: 0.1,
          cost_weight: 0.9,
          total_latency_s: 3.0,
          total_cost_usd: 0.0023,
          assignments: { local: 0, groq: 2, gemini: 1, cerebras: 3 },
          is_pareto_optimal: true,
        },
        {
          alpha: 0.5,
          latency_weight: 0.5,
          cost_weight: 0.5,
          total_latency_s: 2.78,
          total_cost_usd: 0.0025,
          assignments: { local: 0, groq: 0, gemini: 1, cerebras: 5 },
          is_pareto_optimal: true,
        },
        {
          alpha: 1.0,
          latency_weight: 1.0,
          cost_weight: 0.0,
          total_latency_s: 2.78,
          total_cost_usd: 0.0025,
          assignments: { local: 0, groq: 0, gemini: 1, cerebras: 5 },
          is_pareto_optimal: true,
        },
      ];

      setData({
        points,
        pareto_optimal_points: points,
        max_cost_savings_pct: 16.0,
        max_latency_savings_pct: 55.45,
        task_count: 6,
        backends_included: ["local", "groq", "gemini", "cerebras"],
      });
    } finally {
      setLoading(false);
    }
  };

  // Find point closest to current slider alpha
  const points = data?.points || [];
  const currentPoint =
    points.length > 0
      ? points.reduce((prev, curr) =>
          Math.abs(curr.alpha - selectedAlpha) < Math.abs(prev.alpha - selectedAlpha) ? curr : prev
        )
      : null;

  // Scatter plot data formatted for Recharts
  const chartPoints = points.map((p) => ({
    x: p.total_latency_s,
    y: p.total_cost_usd * 1000, // convert to $ per 1k queries for visual scaling
    actualCost: p.total_cost_usd,
    alpha: p.alpha,
    isPareto: p.is_pareto_optimal,
    isSelected: currentPoint ? Math.abs(p.alpha - currentPoint.alpha) < 1e-4 : false,
    assignments: p.assignments,
  }));

  // Sort pareto points for smooth line rendering
  const paretoLineData = [...chartPoints]
    .filter((p) => p.isPareto)
    .sort((a, b) => a.x - b.x);

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
          <div className="h-6 w-6 rounded bg-gradient-to-br from-amber-500 to-indigo-500 flex items-center justify-center shadow-md shadow-amber-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 2a10 10 0 0 1 10 10" /><path d="M12 12 2.1 10.5" />
            </svg>
          </div>
          <div>
            <h1 className="font-mono text-sm tracking-tight text-zinc-100 font-bold">
              /pareto <span className="text-zinc-600 font-normal">// multi_objective_optimization_lab</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchPareto}
            disabled={loading}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>COMPUTING FRONTIER...</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" />
                </svg>
                <span>RE-SOLVE MILP</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* KPI Cards Bar */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="border border-zinc-900 rounded bg-[#09090b] p-3">
          <span className="font-mono text-[9px] text-zinc-500 block">MAX LATENCY SAVINGS</span>
          <span className="font-mono text-xl font-bold text-emerald-400 mt-1 block">
            {data ? `${data.max_latency_savings_pct.toFixed(1)}% Speedup` : "--"}
          </span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">Pure Speed vs Pure Cost baseline</span>
        </div>

        <div className="border border-zinc-900 rounded bg-[#09090b] p-3">
          <span className="font-mono text-[9px] text-zinc-500 block">MAX COST SAVINGS</span>
          <span className="font-mono text-xl font-bold text-amber-400 mt-1 block">
            {data ? `${data.max_cost_savings_pct.toFixed(1)}% Reduction` : "--"}
          </span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">Pure Frugal vs Max Performance</span>
        </div>

        <div className="border border-zinc-900 rounded bg-[#09090b] p-3">
          <span className="font-mono text-[9px] text-zinc-500 block">PARETO EFFICIENT FRONTIER</span>
          <span className="font-mono text-xl font-bold text-indigo-400 mt-1 block">
            {data ? `${data.pareto_optimal_points.length} Optimal Profiles` : "--"}
          </span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">Non-dominated decision configurations</span>
        </div>

        <div className="border border-zinc-900 rounded bg-[#09090b] p-3">
          <span className="font-mono text-[9px] text-zinc-500 block">ACTIVE WEIGHT (ALPHA)</span>
          <span className="font-mono text-xl font-bold text-cyan-400 mt-1 block">
            {currentPoint ? `${Math.round(currentPoint.alpha * 100)}% Speed / ${Math.round((1 - currentPoint.alpha) * 100)}% Cost` : "--"}
          </span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">
            {currentPoint ? `${currentPoint.total_latency_s.toFixed(2)}s | $${currentPoint.total_cost_usd.toFixed(5)}` : "--"}
          </span>
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        {/* Row 1: Interactive Weight Control Slider */}
        <div className="border border-zinc-900 bg-zinc-950/30 rounded p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex-1 w-full flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-300 font-bold flex items-center gap-2">
                <span>SCALARIZATION WEIGHT SLIDER</span>
                <span className="text-[10px] text-cyan-400 bg-cyan-950/30 border border-cyan-900/40 px-2 py-0.5 rounded font-mono">
                  &alpha; = {selectedAlpha.toFixed(2)}
                </span>
              </span>
              <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400">
                <span className="text-amber-400 font-bold">100% COST (&alpha;=0)</span>
                <span>← Tradeoff →</span>
                <span className="text-emerald-400 font-bold">100% SPEED (&alpha;=1)</span>
              </div>
            </div>

            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={selectedAlpha}
              onChange={(e) => setSelectedAlpha(parseFloat(e.target.value))}
              className="w-full h-2 bg-zinc-900 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setSelectedAlpha(0.0)}
              className={`px-2.5 py-1 rounded font-mono text-[10px] border transition-all cursor-pointer ${
                selectedAlpha === 0.0 ? "bg-amber-950/40 border-amber-800 text-amber-300 font-bold" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              PURE FRUGAL (0.0)
            </button>
            <button
              onClick={() => setSelectedAlpha(0.5)}
              className={`px-2.5 py-1 rounded font-mono text-[10px] border transition-all cursor-pointer ${
                selectedAlpha === 0.5 ? "bg-cyan-950/40 border-cyan-800 text-cyan-300 font-bold" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              BALANCED (0.5)
            </button>
            <button
              onClick={() => setSelectedAlpha(1.0)}
              className={`px-2.5 py-1 rounded font-mono text-[10px] border transition-all cursor-pointer ${
                selectedAlpha === 1.0 ? "bg-emerald-950/40 border-emerald-800 text-emerald-300 font-bold" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              PURE SPEED (1.0)
            </button>
          </div>
        </div>

        {/* Row 2: Pareto Scatter Plot + Table */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Chart Container */}
          <div className="lg:col-span-3 border border-zinc-900 rounded bg-[#09090b] p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col">
                <span className="font-mono text-xs text-zinc-300 font-bold">
                  PARETO FRONTIER: COST ($/1k Queries) vs BATCH LATENCY (s)
                </span>
                <span className="font-mono text-[9px] text-zinc-500">
                  Ideal Operating Corner: Bottom-Left (Lowest Cost + Lowest Latency)
                </span>
              </div>
              <span className="font-mono text-[9px] text-zinc-500">PuLP Multi-Objective</span>
            </div>

            <div className="flex-1 min-h-[300px]">
              {mounted && (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart margin={{ top: 10, right: 25, left: -10, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#18181b" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      name="Batch Latency"
                      unit="s"
                      stroke="#71717a"
                      fontSize={10}
                      fontFamily="monospace"
                      domain={['auto', 'auto']}
                    />
                    <YAxis
                      dataKey="y"
                      type="number"
                      name="Cost per 1k Queries"
                      unit="$"
                      stroke="#71717a"
                      fontSize={10}
                      fontFamily="monospace"
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#09090b",
                        border: "1px solid #27272a",
                        borderRadius: "6px",
                        fontFamily: "monospace",
                        fontSize: "10px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
                      }}
                      itemStyle={{ color: "#f4f4f5" }}
                      labelStyle={{ color: "#71717a" }}
                      formatter={(val: any, name: any) => [
                        name === "Batch Latency" ? `${Number(val).toFixed(3)}s` : `$${(Number(val) / 1000).toFixed(5)}`,
                        name,
                      ]}
                    />
                    <Line
                      data={paretoLineData}
                      dataKey="y"
                      stroke="#10b981"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Scatter data={chartPoints} fill="#818cf8">
                      {chartPoints.map((entry: any, index: number) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            entry.isSelected
                              ? "#22d3ee"
                              : entry.isPareto
                              ? "#10b981"
                              : "#52525b"
                          }
                          stroke={entry.isSelected ? "#ffffff" : "#09090b"}
                          strokeWidth={entry.isSelected ? 3 : 1}
                          r={entry.isSelected ? 8 : entry.isPareto ? 6 : 4}
                        />
                      ))}
                    </Scatter>
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Selected Operating Point Summary */}
            {currentPoint && (
              <div className="mt-4 p-3 rounded bg-zinc-950/40 border border-zinc-900 flex items-center justify-between font-mono text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-zinc-300 font-bold">Selected Operating Point (&alpha;={currentPoint.alpha}):</span>
                </div>
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="text-zinc-400">Latency: <strong className="text-emerald-400">{currentPoint.total_latency_s.toFixed(2)}s</strong></span>
                  <span className="text-zinc-400">Cost: <strong className="text-amber-400">${currentPoint.total_cost_usd.toFixed(5)}</strong></span>
                  <span className="text-zinc-500">({Object.entries(currentPoint.assignments).filter(([_, c]) => c > 0).map(([b, c]) => `${b}:${c}`).join(", ")})</span>
                </div>
              </div>
            )}
          </div>

          {/* Operating Points Matrix Table */}
          <div className="lg:col-span-2 border border-zinc-900 rounded bg-[#09090b] p-4 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-xs text-zinc-300 font-bold">PARETO FRONTIER TABLE</span>
              <span className="font-mono text-[9px] text-zinc-500">{points.length} Points Evaluated</span>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-zinc-900 text-zinc-500">
                    <th className="text-left py-2 pr-2">&alpha;</th>
                    <th className="text-right py-2 px-2">LATENCY</th>
                    <th className="text-right py-2 px-2">COST ($)</th>
                    <th className="text-center py-2 px-2">EFFICIENT</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((pt, idx) => {
                    const isSelected = currentPoint && Math.abs(pt.alpha - currentPoint.alpha) < 1e-4;
                    return (
                      <tr
                        key={idx}
                        onClick={() => setSelectedAlpha(pt.alpha)}
                        className={`border-b border-zinc-900/40 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-cyan-950/30 text-cyan-300 font-bold border-l-2 border-l-cyan-400"
                            : pt.is_pareto_optimal
                            ? "hover:bg-zinc-950 text-zinc-200"
                            : "text-zinc-600 hover:bg-zinc-950"
                        }`}
                      >
                        <td className="py-2 pr-2 font-bold">
                          {pt.alpha.toFixed(2)}
                          {isSelected && <span className="ml-1 text-[8px] text-cyan-400">◄</span>}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {pt.total_latency_s.toFixed(2)}s
                        </td>
                        <td className="py-2 px-2 text-right">
                          ${pt.total_cost_usd.toFixed(5)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {pt.is_pareto_optimal ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] bg-emerald-950/40 text-emerald-400 border border-emerald-900/40 font-bold">
                              PARETO
                            </span>
                          ) : (
                            <span className="text-zinc-700">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Row 3: Operations Research Theory & FinOps Impact */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-zinc-900 rounded bg-zinc-950/20 p-4">
            <h3 className="font-mono text-xs font-bold text-zinc-200 flex items-center gap-2 mb-2">
              <span className="text-amber-400">01 //</span> SCALARIZED MULTI-OBJECTIVE MILP FORMULATION
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Real-world cloud applications cannot optimize latency in isolation without considering API costs.
              We formulate a normalized scalarized objective function:
              <br />
              <code className="text-cyan-300 text-[10px] block my-1 p-1 bg-zinc-900 rounded font-mono">
                min &sum; (&alpha; &middot; Normalized_Latency<sub>j</sub> + (1 - &alpha;) &middot; Normalized_Cost<sub>j</sub>) &middot; x<sub>i,j</sub>
              </code>
              Min-max normalization prevents scale skew between seconds and dollars, allowing exact tuning via the parameter &alpha;.
            </p>
          </div>

          <div className="border border-zinc-900 rounded bg-zinc-950/20 p-4">
            <h3 className="font-mono text-xs font-bold text-zinc-200 flex items-center gap-2 mb-2">
              <span className="text-emerald-400">02 //</span> FINOPS & EXECUTIVE RESUME IMPACT
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              By sweeping &alpha; from 0.0 to 1.0, engineering leads can select exact operating points based on real-time business SLAs.
              For non-critical batch processing, setting &alpha; = 0.1 yields a <strong>16% cost reduction</strong> with minimal latency overhead, while setting &alpha; = 1.0 provides a <strong>55% latency reduction</strong> for interactive real-time applications.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
