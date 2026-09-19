"""
Multi-Objective Pareto Frontier Experiment for Aether Router MILP Solver.

Sweeps the multi-objective tradeoff weight alpha in [0.0, 1.0] to balance:
    Objective = alpha * Normalized_Latency + (1 - alpha) * Normalized_Cost

Reveals the Pareto Frontier (Pareto-optimal set of solutions where neither
latency nor cost can be improved without degrading the other).

Usage:
    python backend/experiments/pareto_analysis.py
"""

import os
import sys
import copy
from typing import List, Dict, Any

# Ensure project root is in sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.config import BACKENDS
from backend.optimizer.milp import solve

BENCHMARK_TASKS = [
    {"id": 1, "complexity": "low"},
    {"id": 2, "complexity": "medium"},
    {"id": 3, "complexity": "high"},
    {"id": 4, "complexity": "medium"},
    {"id": 5, "complexity": "low"},
    {"id": 6, "complexity": "medium"},
]


def run_pareto_analysis(
    tasks: List[Dict[str, Any]] | None = None,
    backends: Dict[str, Any] | None = None,
    steps: int = 11,
) -> Dict[str, Any]:
    """
    Sweeps alpha from 0.0 (Pure Cost) to 1.0 (Pure Speed) across `steps` steps,
    solves the MILP for each weight, and computes the non-dominated Pareto Frontier.
    """
    if tasks is None:
        tasks = BENCHMARK_TASKS
    if backends is None:
        backends = copy.deepcopy(BACKENDS)

    alphas = [round(i / (steps - 1), 2) for i in range(steps)]
    raw_points = []

    for alpha in alphas:
        try:
            assignment_map = solve(tasks, backends, alpha=alpha)
        except ValueError:
            continue

        counts: Dict[str, int] = {b: 0 for b in backends}
        total_lat = 0.0
        total_cost = 0.0

        for t in tasks:
            assigned = assignment_map[t["id"]]
            counts[assigned] = counts.get(assigned, 0) + 1
            total_lat += backends[assigned].get("latency_s", 1.0)
            # Cost per 1k tokens (assuming 1k token workload unit per query)
            total_cost += backends[assigned].get("cost_per_1k_tokens", 0.0)

        total_lat = round(total_lat, 4)
        total_cost = round(total_cost, 6)

        raw_points.append({
            "alpha": alpha,
            "latency_weight": alpha,
            "cost_weight": round(1.0 - alpha, 2),
            "total_latency_s": total_lat,
            "total_cost_usd": total_cost,
            "assignments": counts,
            "assignment_map": assignment_map,
        })

    # Deduplicate points by (total_latency_s, total_cost_usd, assignments tuple)
    unique_points = []
    seen = set()
    for pt in raw_points:
        key = (pt["total_latency_s"], pt["total_cost_usd"], tuple(sorted(pt["assignments"].items())))
        if key not in seen:
            seen.add(key)
            unique_points.append(pt)

    # Compute Pareto Dominance
    # A point A dominates point B if (A.lat <= B.lat and A.cost <= B.cost) and (A.lat < B.lat or A.cost < B.cost)
    for i, p1 in enumerate(unique_points):
        dominated = False
        for j, p2 in enumerate(unique_points):
            if i == j:
                continue
            if (
                p2["total_latency_s"] <= p1["total_latency_s"]
                and p2["total_cost_usd"] <= p1["total_cost_usd"]
                and (
                    p2["total_latency_s"] < p1["total_latency_s"]
                    or p2["total_cost_usd"] < p1["total_cost_usd"]
                )
            ):
                dominated = True
                break
        p1["is_pareto_optimal"] = not dominated

    # Calculate tradeoff statistics
    min_cost_point = min(unique_points, key=lambda x: x["total_cost_usd"])
    min_lat_point = min(unique_points, key=lambda x: x["total_latency_s"])

    max_latency_savings_pct = 0.0
    if min_cost_point["total_latency_s"] > 0:
        max_latency_savings_pct = round(
            ((min_cost_point["total_latency_s"] - min_lat_point["total_latency_s"])
             / min_cost_point["total_latency_s"]) * 100, 2
        )

    max_cost_savings_pct = 0.0
    if min_lat_point["total_cost_usd"] > 0:
        max_cost_savings_pct = round(
            ((min_lat_point["total_cost_usd"] - min_cost_point["total_cost_usd"])
             / min_lat_point["total_cost_usd"]) * 100, 2
        )

    return {
        "points": unique_points,
        "all_sweep_points": raw_points,
        "pareto_optimal_points": [p for p in unique_points if p["is_pareto_optimal"]],
        "min_cost_operating_point": min_cost_point,
        "min_latency_operating_point": min_lat_point,
        "max_cost_savings_pct": max_cost_savings_pct,
        "max_latency_savings_pct": max_latency_savings_pct,
        "task_count": len(tasks),
        "backends_included": list(backends.keys()),
    }


def main():
    print("=====================================================================")
    print("  Aether Router -- Multi-Objective Pareto Frontier Experiment")
    print("  Balancing Latency Minimization vs. Cost Minimization via MILP")
    print("=====================================================================")

    res = run_pareto_analysis()
    points = res["points"]

    print(f"\n  Task Batch Size: {res['task_count']} queries")
    print(f"  Backends Included: {', '.join(res['backends_included'])}\n")
    print(f"  {'Alpha':<6} | {'Lat Weight':<10} | {'Cost Weight':<11} | {'Latency (s)':<11} | {'Cost ($)':<10} | {'Pareto Optimal?':<16} | {'Assignments'}")
    print("-" * 110)

    for p in points:
        pareto_str = "* YES" if p["is_pareto_optimal"] else "  no"
        counts_str = ", ".join(f"{b}:{c}" for b, c in p["assignments"].items() if c > 0)
        print(
            f"  {p['alpha']:<6.2f} | {p['latency_weight']:<10.2f} | {p['cost_weight']:<11.2f} | "
            f"{p['total_latency_s']:<11.4f} | ${p['total_cost_usd']:<9.6f} | {pareto_str:<16} | {counts_str}"
        )

    print("\n" + "=" * 110)
    print("  PARETO EFFICIENCY SUMMARY")
    print("=" * 110)
    print(f"  Max Latency Savings (Pure Speed vs Pure Cost) : {res['max_latency_savings_pct']}% reduction")
    print(f"  Max Cost Savings (Pure Cost vs Pure Speed)    : {res['max_cost_savings_pct']}% reduction")
    print(f"  Pareto Frontier Operating Points Count        : {len(res['pareto_optimal_points'])} distinct optimal profiles")
    print("=" * 110 + "\n")


if __name__ == "__main__":
    main()
