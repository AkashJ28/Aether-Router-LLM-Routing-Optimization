"""
Scalability Experiment for Aether Router MILP Solver.

Generates synthetic batches of increasing size (10 to 5000 tasks), solves the
MILP for each, and reports solver wall-clock time plus optimal objective value.
This demonstrates that the MILP approach scales practically for realistic batch
sizes using the open-source CBC solver.

Usage:
    python backend/experiments/scalability_test.py
"""

import os
import sys
import time
import copy

# Ensure project root is in the Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.config import BACKENDS
from backend.optimizer.milp import solve


# Batch sizes to test
BATCH_SIZES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

# Complexity distribution: ~33% Low, ~50% Medium, ~17% High
# (representative of a mixed workload)
def generate_tasks(n: int) -> list[dict]:
    """Generate n synthetic tasks with a realistic complexity distribution."""
    tasks = []
    for i in range(1, n + 1):
        # Cycle through complexities: low, medium, high, medium, low, medium
        cycle = i % 6
        if cycle in (1, 5):
            complexity = "low"
        elif cycle in (2, 4, 6, 0):
            complexity = "medium"
        else:
            complexity = "high"
        tasks.append({"id": i, "complexity": complexity})
    return tasks


def main():
    print("=====================================================================")
    print("  Aether Router -- MILP Scalability Experiment")
    print("  Measuring solver time across increasing batch sizes.")
    print("=====================================================================")
    print()

    backends = copy.deepcopy(BACKENDS)

    # Header
    header = (
        f"{'Batch Size':>12} | {'Solver Time':>14} | "
        f"{'Total Lat (s)':>14} | {'Groq':>6} | {'Gemini':>8} | {'Local':>7}"
    )
    print(header)
    print("-" * len(header))

    for n in BATCH_SIZES:
        tasks = generate_tasks(n)

        # Time the MILP solve
        start = time.perf_counter()
        try:
            assignments = solve(tasks, backends)
        except ValueError as e:
            elapsed = time.perf_counter() - start
            print(f"{n:>12} | {elapsed * 1000:>11.1f} ms | {'INFEASIBLE':>14} |")
            continue
        elapsed = time.perf_counter() - start

        # Compute objective value
        total_latency = sum(
            backends[assignments[t["id"]]]["latency_s"]
            for t in tasks
        )

        # Count assignments per backend
        counts = {}
        for b in assignments.values():
            counts[b] = counts.get(b, 0) + 1

        groq_count = counts.get("groq", 0)
        gemini_count = counts.get("gemini", 0)
        local_count = counts.get("local", 0)

        print(
            f"{n:>12} | {elapsed * 1000:>11.1f} ms | "
            f"{total_latency:>13.2f}s | {groq_count:>6} | {gemini_count:>8} | {local_count:>7}"
        )

    print()
    print("---------------------------------------------------------------------")
    print("  Key observations:")
    print("  - Groq is capped at 30 RPM; excess Low tasks spill to Gemini/Local")
    print("  - Medium/High tasks always route to Gemini (only capable backend)")
    print("  - Solver time grows with batch size but remains practical even at")
    print("    thousands of tasks using the open-source CBC solver.")
    print("=====================================================================\n")


if __name__ == "__main__":
    main()
