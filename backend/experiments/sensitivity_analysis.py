"""
Sensitivity Analysis Experiment for Aether Router MILP Solver.

Varies each backend's latency parameter across a range (0.25x to 3.0x of the
calibrated baseline) while keeping all other parameters fixed, and re-solves
the MILP for each variation. This reveals:

  1. How robust the optimal assignment is to latency measurement error.
  2. At what latency threshold the solver switches routing decisions.
  3. Whether the current operating point is near a breakeven boundary.

Usage:
    python backend/experiments/sensitivity_analysis.py
"""

import os
import sys
import copy

# Ensure project root is in the Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.config import BACKENDS
from backend.optimizer.milp import solve


# -- Benchmark task set (same 6 queries used in Section 5 of the report) ------
BENCHMARK_TASKS = [
    {"id": 1, "complexity": "low"},
    {"id": 2, "complexity": "medium"},
    {"id": 3, "complexity": "high"},
    {"id": 4, "complexity": "medium"},
    {"id": 5, "complexity": "low"},
    {"id": 6, "complexity": "medium"},
]

# Multipliers to apply to the baseline latency of the backend under analysis.
# 0.25x = "what if it were 4x faster?" ... 3.0x = "what if it were 3x slower?"
MULTIPLIERS = [0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 2.00, 2.50, 3.00]


def count_assignments(assignments: dict[int, str]) -> dict[str, int]:
    """Count how many tasks are assigned to each backend."""
    counts = {}
    for backend in assignments.values():
        counts[backend] = counts.get(backend, 0) + 1
    return counts


def run_sensitivity_for_backend(target_backend: str) -> list[dict]:
    """
    Vary the latency of `target_backend` across MULTIPLIERS and solve the MILP
    for each. Returns a list of result dicts, one per multiplier.
    """
    baseline_latency = BACKENDS[target_backend]["latency_s"]
    results = []

    for mult in MULTIPLIERS:
        # Deep copy backends and override the target's latency
        backends = copy.deepcopy(BACKENDS)
        varied_latency = round(baseline_latency * mult, 4)
        backends[target_backend]["latency_s"] = varied_latency

        try:
            assignments = solve(BENCHMARK_TASKS, backends)
            counts = count_assignments(assignments)

            # Compute objective value (total service latency)
            total_latency = sum(
                backends[assignments[t["id"]]]["latency_s"]
                for t in BENCHMARK_TASKS
            )

            results.append({
                "multiplier": mult,
                "varied_latency": varied_latency,
                "assignments": assignments,
                "counts": counts,
                "total_latency": round(total_latency, 4),
                "error": None,
            })
        except ValueError as e:
            results.append({
                "multiplier": mult,
                "varied_latency": varied_latency,
                "assignments": {},
                "counts": {},
                "total_latency": None,
                "error": str(e),
            })

    return results


def detect_breakeven(results: list[dict], target_backend: str) -> list[str]:
    """Detect points where the assignment pattern changes between consecutive rows."""
    breakevens = []
    for i in range(1, len(results)):
        prev = results[i - 1]
        curr = results[i]
        if prev["error"] or curr["error"]:
            continue
        if prev["counts"] != curr["counts"]:
            breakevens.append(
                f"  >> Assignment shift between {target_backend} latency "
                f"{prev['varied_latency']}s ({prev['multiplier']}x) and "
                f"{curr['varied_latency']}s ({curr['multiplier']}x): "
                f"{prev['counts']} -> {curr['counts']}"
            )
    return breakevens


def print_table(target_backend: str, results: list[dict]):
    """Pretty-print the sensitivity table for one backend."""
    baseline_latency = BACKENDS[target_backend]["latency_s"]
    all_backends = sorted(BACKENDS.keys())

    print(f"\n{'=' * 90}")
    print(f"  SENSITIVITY ANALYSIS: {target_backend.upper()} latency")
    print(f"  Baseline: {baseline_latency} s  |  Task mix: 2 Low, 3 Medium, 1 High")
    print(f"{'=' * 90}")

    # Header
    header = f"{'Mult':>6} | {target_backend + ' Lat.':>10} |"
    for b in all_backends:
        header += f" {b:>9} |"
    header += f" {'Obj. (s)':>10} | {'Note':>10}"
    print(header)
    print("-" * len(header))

    for r in results:
        if r["error"]:
            row = f"{r['multiplier']:>5}x | {r['varied_latency']:>9}s |"
            for b in all_backends:
                row += f" {'---':>9} |"
            row += f" {'INFEAS.':>10} |"
            print(row)
            continue

        is_baseline = abs(r["multiplier"] - 1.0) < 1e-6
        note = "<- current" if is_baseline else ""
        row = f"{r['multiplier']:>5}x | {r['varied_latency']:>9}s |"
        for b in all_backends:
            count = r["counts"].get(b, 0)
            row += f" {count:>9} |"
        row += f" {r['total_latency']:>9}s | {note:>10}"
        print(row)

    # Breakeven detection
    breakevens = detect_breakeven(results, target_backend)
    if breakevens:
        print(f"\n  Breakeven points detected:")
        for be in breakevens:
            print(be)
    else:
        print(f"\n  No assignment shifts detected across the tested range.")


def run_sensitivity(
    tasks: list[dict] | None = None,
    backends: dict | None = None,
    multipliers: list[float] | None = None,
) -> list[dict]:
    """
    Run sensitivity analysis across all backends, returning a flat list of
    result dicts suitable for JSON serialization and the /sensitivity API.

    Each result dict has:
        varied_backend, multiplier, varied_latency_s, assignments (counts),
        total_latency_s, is_baseline, breakeven_note
    """
    if tasks is None:
        tasks = BENCHMARK_TASKS
    if backends is None:
        backends = copy.deepcopy(BACKENDS)
    if multipliers is None:
        multipliers = list(MULTIPLIERS)

    results = []

    for target_backend in backends:
        base_latency = backends[target_backend]["latency_s"]
        if base_latency is None:
            continue

        prev_counts: dict[str, int] | None = None

        for mult in sorted(multipliers):
            modified = copy.deepcopy(backends)
            new_latency = round(base_latency * mult, 4)
            modified[target_backend]["latency_s"] = new_latency

            try:
                assignment_map = solve(tasks, modified)
            except ValueError:
                continue

            counts: dict[str, int] = {b: 0 for b in backends}
            for assigned in assignment_map.values():
                counts[assigned] = counts.get(assigned, 0) + 1

            total_lat = sum(
                modified[assignment_map[t["id"]]]["latency_s"]
                for t in tasks
            )
            total_lat = round(total_lat, 4)

            breakeven_note: str | None = None
            if prev_counts is not None and counts != prev_counts:
                breakeven_note = (
                    f"Assignment shifts at {target_backend} latency = {new_latency}s"
                )

            results.append({
                "varied_backend": target_backend,
                "multiplier": mult,
                "varied_latency_s": new_latency,
                "assignments": counts,
                "total_latency_s": total_lat,
                "is_baseline": abs(mult - 1.0) < 1e-9,
                "breakeven_note": breakeven_note,
            })

            prev_counts = counts

    return results


def main():
    print("=====================================================================")
    print("  Aether Router -- MILP Sensitivity Analysis Experiment")
    print("  Varying one backend's latency at a time, keeping others fixed.")
    print("=====================================================================")

    for backend_name in sorted(BACKENDS.keys()):
        results = run_sensitivity_for_backend(backend_name)
        print_table(backend_name, results)

    print(f"\n{'=' * 90}")
    print("  SUMMARY")
    print(f"{'=' * 90}")
    print("  This analysis shows the robustness of the MILP optimal assignment to")
    print("  latency parameter uncertainty. If assignments remain stable across a")
    print("  wide multiplier range, the solution is robust. Breakeven points mark")
    print("  latencies where the solver switches its routing decision -- these are")
    print("  critical thresholds for operational monitoring.")
    print(f"{'=' * 90}\n")


if __name__ == "__main__":
    main()

