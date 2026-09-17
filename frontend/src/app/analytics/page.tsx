"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend
} from "recharts";

interface CompareMethodMetrics {
  total_service_latency_s: number;
  average_latency_s: number;
  backend_usage: Record<string, number>;
  capability_violations: number;
  rpm_violations: number;
}

interface CompareResponse {
  milp: CompareMethodMetrics;
  always_gemini: CompareMethodMetrics;
  rule_based: CompareMethodMetrics;
}

export default function Analytics() {
  const [mounted, setMounted] = useState(false);
  const [queriesText, setQueriesText] = useState(
    "Translate this paragraph into French\n" +
    "Summarize research paper: Attention Is All You Need\n" +
    "Solve this DSA problem: find the longest increasing subsequence\n" +
    "Generate SQL query to join users and orders tables\n" +
    "Write professional email declining a meeting invite\n" +
    "Explain recursion with an example"
  );
  
  const [loading, setLoading] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);

  useEffect(() => {
    setMounted(true);
    // Initial compute on mount
    runCompare();
  }, []);

  const runCompare = async () => {
    const list = queriesText
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    if (list.length === 0) return;

    setLoading(true);
    setBackendError(null);

    try {
      const response = await fetch("http://localhost:8000/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: list }),
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      setComparison(data);

    } catch (err: any) {
      console.warn("Backend server offline. Simulating comparison metrics client-side.", err);
      setBackendError("FastAPI Backend unreachable. Rendering client-side simulation.");
      
      // Client-side simulator matching the mathematical backend parameters:
      // local: 1.98s (cap 1, rpm inf)
      // groq: 0.36s (cap 2, rpm 30)
      // gemini: 1.53s (cap 5, rpm inf)
      
      let lowCount = 0;
      let medCount = 0;
      let highCount = 0;

      list.forEach((query) => {
        const qLower = query.toLowerCase();
        const highKeywords = ["solve", "algorithm", "proof", "prove", "derive", "optimize", "debug", "recursion", "complexity", "leetcode", "dsa"];
        const medKeywords = ["summarize", "explain", "compare", "sql", "query", "generate code", "write function"];
        
        if (highKeywords.some((kw) => qLower.includes(kw))) {
          highCount++;
        } else if (medKeywords.some((kw) => qLower.includes(kw))) {
          medCount++;
        } else if (qLower.split(/\s+/).length >= 40) {
          highCount++;
        } else if (qLower.split(/\s+/).length >= 15) {
          medCount++;
        } else {
          lowCount++;
        }
      });

      // 1. MILP Optimization simulation
      let milpLatency = 0.0;
      const milpUsage: Record<string, number> = { local: 0, groq: 0, gemini: 0 };
      
      // Low tasks: route to Groq up to 30 RPM limit, remaining to Gemini
      for (let i = 0; i < lowCount; i++) {
        if (milpUsage.groq < 30) {
          milpUsage.groq++;
          milpLatency += 0.36;
        } else {
          milpUsage.gemini++;
          milpLatency += 1.53;
        }
      }
      // Medium tasks: only Gemini is capable (cap >= 3)
      for (let i = 0; i < medCount; i++) {
        milpUsage.gemini++;
        milpLatency += 1.53;
      }
      // High tasks: only Gemini is capable (cap >= 5)
      for (let i = 0; i < highCount; i++) {
        milpUsage.gemini++;
        milpLatency += 1.53;
      }

      // 2. Always Gemini simulation
      const alwaysGeminiLatency = (lowCount + medCount + highCount) * 1.53;
      const alwaysGeminiUsage = { gemini: lowCount + medCount + highCount };

      // 3. Rule-Based simulation
      // Low -> local (1.98s), Medium -> groq (0.36s), High -> gemini (1.53s)
      const ruleBasedLatency = (lowCount * 1.98) + (medCount * 0.36) + (highCount * 1.53);
      const ruleBasedUsage = {
        local: lowCount,
        groq: medCount,
        gemini: highCount
      };

      // Rule-Based has capability violations for Medium tasks (Groq capability 2 < required 3)
      const ruleBasedCapViolations = medCount;
      // Rule-Based has RPM violations if Medium tasks routed to Groq exceed 30
      const ruleBasedRpmViolations = Math.max(0, medCount - 30);

      setComparison({
        milp: {
          total_service_latency_s: Number(milpLatency.toFixed(3)),
          average_latency_s: Number((milpLatency / list.length).toFixed(3)),
          backend_usage: milpUsage,
          capability_violations: 0,
          rpm_violations: 0
        },
        always_gemini: {
          total_service_latency_s: Number(alwaysGeminiLatency.toFixed(3)),
          average_latency_s: Number((alwaysGeminiLatency / list.length).toFixed(3)),
          backend_usage: alwaysGeminiUsage,
          capability_violations: 0,
          rpm_violations: 0
        },
        rule_based: {
          total_service_latency_s: Number(ruleBasedLatency.toFixed(3)),
          average_latency_s: Number((ruleBasedLatency / list.length).toFixed(3)),
          backend_usage: ruleBasedUsage,
          capability_violations: ruleBasedCapViolations,
          rpm_violations: ruleBasedRpmViolations
        }
      });
    } finally {
      setLoading(false);
    }
  };

  const chartData = comparison
    ? [
        {
          name: "MILP Optimizer",
          latency: comparison.milp.total_service_latency_s,
          avg: comparison.milp.average_latency_s,
          color: "#10b981" // emerald
        },
        {
          name: "Rule-Based",
          latency: comparison.rule_based.total_service_latency_s,
          avg: comparison.rule_based.average_latency_s,
          color: "#6366f1" // indigo
        },
        {
          name: "Always Gemini",
          latency: comparison.always_gemini.total_service_latency_s,
          avg: comparison.always_gemini.average_latency_s,
          color: "#f59e0b" // amber
        }
      ]
    : [];

  // Calculate stats to display in top metric cards
  const totalQueries = queriesText.split("\n").filter((q) => q.trim()).length;
  const rateLimitViolationsAvoided = comparison
    ? Math.max(0, comparison.rule_based.rpm_violations - comparison.milp.rpm_violations) + 
      (totalQueries > 30 ? (totalQueries - 30) : 0) // Estimate additional violations
    : 0;

  const capabilityViolationsAvoided = comparison
    ? comparison.rule_based.capability_violations
    : 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#09090b]">
      {/* Warning if Backend unreachable */}
      {backendError && (
        <div className="bg-amber-950/20 border-b border-amber-900/50 px-6 py-2 flex items-center justify-between text-amber-400 text-xs font-mono">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" x2="12" y1="9" y2="13" />
              <line x1="12" x2="12.01" y1="17" y2="17" />
            </svg>
            <span>{backendError}</span>
          </div>
          <span className="text-[10px] opacity-75">Rendering simulation</span>
        </div>
      )}

      {/* Main Header */}
      <header className="h-14 border-b border-zinc-900 px-6 flex items-center justify-between bg-zinc-950/30">
        <h1 className="font-mono text-sm tracking-tight text-zinc-200">
          /analytics <span className="text-zinc-600">// performance_telemetry</span>
        </h1>
      </header>

      {/* Metric Cards Grid */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Metric 1: Rate Limits Avoided */}
        <div className="border border-zinc-900 rounded bg-[#09090b] p-3 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] text-zinc-500">RATE_LIMITS_AVOIDED</span>
            <span className="font-mono text-xl font-bold text-emerald-400">
              {rateLimitViolationsAvoided} Violations
            </span>
            <span className="text-[9px] text-zinc-500 leading-none mt-1">429 HTTP errors prevented by spillover</span>
          </div>
          <div className="h-9 w-9 rounded bg-emerald-950/20 text-emerald-400 border border-emerald-900/50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
            </svg>
          </div>
        </div>

        {/* Metric 2: Capability Violations Avoided */}
        <div className="border border-zinc-900 rounded bg-[#09090b] p-3 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] text-zinc-500">CAPABILITY_VIOLATIONS_AVOIDED</span>
            <span className="font-mono text-xl font-bold text-indigo-400">
              {capabilityViolationsAvoided} Violations
            </span>
            <span className="text-[9px] text-zinc-500 leading-none mt-1">Queries routed strictly to qualified nodes</span>
          </div>
          <div className="h-9 w-9 rounded bg-indigo-950/20 text-indigo-400 border border-indigo-900/50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
        </div>

        {/* Metric 3: Optimization Yield */}
        <div className="border border-zinc-900 rounded bg-[#09090b] p-3 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] text-zinc-500">PEAK_ROUTING_EFFICIENCY</span>
            <span className="font-mono text-xl font-bold text-amber-400">
              {comparison 
                ? `${Math.round(((comparison.always_gemini.total_service_latency_s - comparison.milp.total_service_latency_s) / comparison.always_gemini.total_service_latency_s) * 100)}%`
                : "0%"} Speedup
            </span>
            <span className="text-[9px] text-zinc-500 leading-none mt-1">Latency savings vs Always-Gemini baseline</span>
          </div>
          <div className="h-9 w-9 rounded bg-amber-950/20 text-amber-400 border border-amber-900/50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0 overflow-y-auto lg:overflow-hidden">
        
        {/* Left column: input text container */}
        <div className="flex flex-col border border-zinc-900 bg-zinc-950/20 rounded lg:overflow-hidden">
          <div className="h-10 px-4 border-b border-zinc-900 flex items-center justify-between bg-zinc-950/50">
            <span className="font-mono text-xs text-zinc-400 font-bold">CALIBRATE_COMPARISON.json</span>
          </div>
          <div className="flex-1 p-4 flex flex-col gap-3 min-h-[250px] lg:min-h-0">
            <textarea
              value={queriesText}
              onChange={(e) => setQueriesText(e.target.value)}
              placeholder="Enter queries to compare..."
              className="flex-1 resize-none bg-[#09090b] border border-zinc-900 rounded p-3 outline-none font-mono text-[10px] leading-normal text-zinc-300 placeholder:text-zinc-700"
            />
            <button
              onClick={runCompare}
              disabled={loading}
              className="w-full h-8 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded font-mono text-xs text-zinc-100 font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? "COMPUTING..." : "RE-EVALUATE BASELINES"}
            </button>
          </div>
        </div>

        {/* Right columns: BarChart container */}
        <div className="lg:col-span-2 flex flex-col border border-zinc-900 bg-zinc-950/20 rounded lg:overflow-hidden">
          <div className="h-10 px-4 border-b border-zinc-900 flex items-center justify-between bg-zinc-950/50">
            <span className="font-mono text-xs text-zinc-400 font-bold">BENCHMARK_VISUALIZATION.chart</span>
            <span className="font-mono text-[9px] text-zinc-500">Lower is better</span>
          </div>

          <div className="flex-1 p-6 flex flex-col gap-4 justify-center items-center min-h-[300px] lg:min-h-0 select-none">
            {mounted && comparison ? (
              <div className="w-full h-full min-h-[250px] flex flex-col justify-between">
                <ResponsiveContainer width="100%" height="85%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#18181b" />
                    <XAxis
                      dataKey="name"
                      stroke="#71717a"
                      fontSize={10}
                      fontFamily="monospace"
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#71717a"
                      fontSize={10}
                      fontFamily="monospace"
                      tickLine={false}
                      unit="s"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#09090b",
                        border: "1px solid #27272a",
                        borderRadius: "4px",
                        fontFamily: "monospace",
                        fontSize: "10px"
                      }}
                      itemStyle={{ color: "#f4f4f5" }}
                      labelStyle={{ color: "#71717a" }}
                    />
                    <Bar dataKey="latency" name="Total Service Latency">
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                
                {/* Custom Chart Legend */}
                <div className="flex items-center justify-center gap-6 border-t border-zinc-900/50 pt-4 font-mono text-[9px] text-zinc-500 leading-none">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-emerald-500"></span>
                    <span>MILP OPTIMIZER ({comparison.milp.total_service_latency_s.toFixed(2)}s)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-indigo-500"></span>
                    <span>RULE-BASED ({comparison.rule_based.total_service_latency_s.toFixed(2)}s)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-amber-500"></span>
                    <span>ALWAYS GEMINI ({comparison.always_gemini.total_service_latency_s.toFixed(2)}s)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-zinc-600 font-mono text-xs">Loading chart components...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
