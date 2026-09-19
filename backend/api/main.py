import sys
from pathlib import Path

# Ensure project root is in sys.path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from concurrent.futures import ThreadPoolExecutor
from backend.config import BACKENDS
from backend.optimizer.complexity import classify_complexity
from backend.optimizer.milp import solve
from backend.optimizer.baselines import baseline_always_gemini, baseline_rule_based
from backend.clients.llm_client import LLMClient
from backend.experiments.sensitivity_analysis import run_sensitivity
from backend.experiments.pareto_analysis import run_pareto_analysis


def get_enabled_backends() -> dict:
    """Return only backends with enabled=True (for live /route execution)."""
    return {name: info for name, info in BACKENDS.items() if info.get("enabled", True)}

app = FastAPI(
    title="LLM Routing and Optimization API",
    description="Cost and Latency Optimization Framework for LLM Routing using MILP",
    version="1.0.0"
)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic schemas for requests and responses
class RouteRequest(BaseModel):
    queries: list[str]
    alpha: float = 1.0

class RouteResultItem(BaseModel):
    id: int
    query: str
    complexity: str
    assigned_backend: str
    response_text: str
    latency_s: float

class RouteSummary(BaseModel):
    total_service_latency_s: float
    average_latency_s: float
    batch_wallclock_s: float          # max individual latency (concurrent execution time)
    backend_usage: dict[str, int]

class RouteResponse(BaseModel):
    results: list[RouteResultItem]
    summary: RouteSummary

class CompareRequest(BaseModel):
    queries: list[str]
    alpha: float = 1.0

class CompareMethodMetrics(BaseModel):
    total_service_latency_s: float
    average_latency_s: float
    batch_wallclock_s: float          # max individual latency (concurrent execution time)
    backend_usage: dict[str, int]
    capability_violations: int
    rpm_violations: int

class CompareResponse(BaseModel):
    milp: CompareMethodMetrics
    always_gemini: CompareMethodMetrics
    rule_based: CompareMethodMetrics


# Helper function to get capability requirement score
def get_required_capability(complexity: str) -> int:
    complexity_map = {
        "low": 1,
        "medium": 3,
        "high": 5
    }
    return complexity_map.get(complexity.lower(), 3)


# Helper function to get backends (substituting fallback latencies if None)
def get_backends_with_fallbacks(enabled_only: bool = True) -> dict:
    """Return backends with fallback latencies. If enabled_only=True, skip disabled backends."""
    fallbacks = {
        "local": 0.8,
        "groq": 0.5,
        "gemini": 1.0,
        "cerebras": 0.3,
    }
    resolved = {}
    for name, info in BACKENDS.items():
        if enabled_only and not info.get("enabled", True):
            continue
        resolved[name] = info.copy()
        if resolved[name].get("latency_s") is None:
            resolved[name]["latency_s"] = fallbacks.get(name, 1.0)
    return resolved


@app.post("/route", response_model=RouteResponse)
def route_queries(request: RouteRequest):
    if not request.queries:
        raise HTTPException(status_code=400, detail="The queries list cannot be empty.")

    # Classify complexity for each query
    tasks = []
    for idx, query in enumerate(request.queries):
        complexity = classify_complexity(query)
        tasks.append({
            "id": idx + 1,
            "query": query,
            "complexity": complexity
        })

    # Prepare backend configurations (only enabled backends for live execution)
    backends = get_backends_with_fallbacks(enabled_only=True)

    # Solve MILP assignments
    try:
        assignments = solve(tasks, backends, alpha=request.alpha)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Optimization failed: {str(e)}")

    # Execute LLM calls concurrently
    llm_client = LLMClient()
    results = []

    def execute_task(task):
        t_id = task["id"]
        query = task["query"]
        complexity = task["complexity"]
        backend = assignments[t_id]
        
        # Call the live LLM
        res = llm_client.call(backend, query)
        
        # Populate response text. If error occurs, return error text instead.
        response_text = res["text"]
        if res.get("error"):
            response_text = f"Error calling {backend}: {res['error']}"

        return RouteResultItem(
            id=t_id,
            query=query,
            complexity=complexity,
            assigned_backend=backend,
            response_text=response_text,
            latency_s=res["latency_s"]
        )

    with ThreadPoolExecutor() as executor:
        results = list(executor.map(execute_task, tasks))

    # Sort results by task ID
    results.sort(key=lambda item: item.id)

    # Compute summary metrics
    total_service_latency_s = sum(item.latency_s for item in results)
    average_latency_s = total_service_latency_s / len(results) if results else 0.0
    batch_wallclock_s = max(item.latency_s for item in results) if results else 0.0

    backend_usage = {}
    for item in results:
        backend_usage[item.assigned_backend] = backend_usage.get(item.assigned_backend, 0) + 1

    summary = RouteSummary(
        total_service_latency_s=round(total_service_latency_s, 4),
        average_latency_s=round(average_latency_s, 4),
        batch_wallclock_s=round(batch_wallclock_s, 4),
        backend_usage=backend_usage
    )

    return RouteResponse(results=results, summary=summary)


@app.post("/compare", response_model=CompareResponse)
def compare_routing_algorithms(request: CompareRequest):
    if not request.queries:
        raise HTTPException(status_code=400, detail="The queries list cannot be empty.")

    # Classify complexity
    tasks = []
    for idx, query in enumerate(request.queries):
        complexity = classify_complexity(query)
        tasks.append({
            "id": idx + 1,
            "query": query,
            "complexity": complexity
        })

    # Use ALL backends (including disabled) for simulation comparison
    backends = get_backends_with_fallbacks(enabled_only=False)

    # Generate routing maps using all 3 algorithms
    try:
        milp_mapping = solve(tasks, backends, alpha=request.alpha)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"MILP failed: {str(e)}")

    always_gemini_mapping = baseline_always_gemini(tasks)
    rule_based_mapping = baseline_rule_based(tasks)

    # Helper function to compute metrics for a given routing configuration
    def compute_metrics(mapping: dict[int, str]) -> CompareMethodMetrics:
        total_latency = 0.0
        max_latency = 0.0
        usage = {}
        cap_violations = 0
        rpm_violations = 0

        # Calculate latency, capability violations, and usage
        for task in tasks:
            t_id = task["id"]
            complexity = task["complexity"]
            req_cap = get_required_capability(complexity)
            assigned = mapping[t_id]

            # Latency (simulated using configured profile)
            task_latency = backends[assigned]["latency_s"]
            total_latency += task_latency
            max_latency = max(max_latency, task_latency)

            # Usage count
            usage[assigned] = usage.get(assigned, 0) + 1

            # Capability check
            backend_cap = backends[assigned].get("capability", 0)
            if backend_cap < req_cap:
                cap_violations += 1

        # Calculate RPM violations based on simulated usage
        for b_name, count in usage.items():
            rpm_limit = backends[b_name].get("rpm_limit")
            if rpm_limit is not None and count > rpm_limit:
                rpm_violations += (count - rpm_limit)

        avg_latency = total_latency / len(tasks) if tasks else 0.0

        return CompareMethodMetrics(
            total_service_latency_s=round(total_latency, 4),
            average_latency_s=round(avg_latency, 4),
            batch_wallclock_s=round(max_latency, 4),
            backend_usage=usage,
            capability_violations=cap_violations,
            rpm_violations=rpm_violations
        )

    # Calculate metrics for each method
    milp_metrics = compute_metrics(milp_mapping)
    always_gemini_metrics = compute_metrics(always_gemini_mapping)
    rule_based_metrics = compute_metrics(rule_based_mapping)

    return CompareResponse(
        milp=milp_metrics,
        always_gemini=always_gemini_metrics,
        rule_based=rule_based_metrics
    )


# ── Sensitivity Analysis ──────────────────────────────────────────────────
class SensitivityRequest(BaseModel):
    queries: list[str] | None = None
    multipliers: list[float] | None = None

class SensitivityResultItem(BaseModel):
    varied_backend: str
    multiplier: float
    varied_latency_s: float
    assignments: dict[str, int]
    total_latency_s: float
    is_baseline: bool
    breakeven_note: str | None

class SensitivityResponse(BaseModel):
    results: list[SensitivityResultItem]
    backends_analyzed: list[str]
    multipliers_used: list[float]
    task_count: int


@app.post("/sensitivity", response_model=SensitivityResponse)
def sensitivity_analysis(request: SensitivityRequest):
    """
    Run sensitivity analysis: vary each backend's latency across a multiplier range,
    re-solve the MILP for each variation, report how assignments shift.
    """
    backends = get_backends_with_fallbacks(enabled_only=False)

    # Build tasks from provided queries, or use defaults
    tasks = None
    if request.queries and len(request.queries) > 0:
        tasks = []
        for idx, query in enumerate(request.queries):
            complexity = classify_complexity(query)
            tasks.append({
                "id": idx + 1,
                "query": query,
                "complexity": complexity
            })

    multipliers = request.multipliers or [0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 2.00, 2.50, 3.00]

    try:
        raw_results = run_sensitivity(
            tasks=tasks,
            backends=backends,
            multipliers=multipliers,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Sensitivity analysis failed: {str(e)}")

    task_count = len(tasks) if tasks else 6  # default batch size

    return SensitivityResponse(
        results=[SensitivityResultItem(**r) for r in raw_results],
        backends_analyzed=list(backends.keys()),
        multipliers_used=multipliers,
        task_count=task_count,
    )


# ── Multi-Objective Pareto Frontier ──────────────────────────────────────
class ParetoRequest(BaseModel):
    queries: list[str] | None = None
    steps: int = 11

class ParetoPointItem(BaseModel):
    alpha: float
    latency_weight: float
    cost_weight: float
    total_latency_s: float
    total_cost_usd: float
    assignments: dict[str, int]
    is_pareto_optimal: bool

class ParetoResponse(BaseModel):
    points: list[ParetoPointItem]
    pareto_optimal_points: list[ParetoPointItem]
    max_cost_savings_pct: float
    max_latency_savings_pct: float
    task_count: int
    backends_included: list[str]


@app.post("/pareto", response_model=ParetoResponse)
def pareto_analysis(request: ParetoRequest):
    """
    Run Multi-Objective Pareto Frontier Analysis: sweep alpha weight in [0.0, 1.0]
    to balance Latency Minimization vs. Cost Minimization.
    """
    backends = get_backends_with_fallbacks(enabled_only=False)

    tasks = None
    if request.queries and len(request.queries) > 0:
        tasks = []
        for idx, query in enumerate(request.queries):
            complexity = classify_complexity(query)
            tasks.append({
                "id": idx + 1,
                "query": query,
                "complexity": complexity
            })

    try:
        raw = run_pareto_analysis(
            tasks=tasks,
            backends=backends,
            steps=request.steps,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Pareto analysis failed: {str(e)}")

    return ParetoResponse(
        points=[ParetoPointItem(**p) for p in raw["points"]],
        pareto_optimal_points=[ParetoPointItem(**p) for p in raw["pareto_optimal_points"]],
        max_cost_savings_pct=raw["max_cost_savings_pct"],
        max_latency_savings_pct=raw["max_latency_savings_pct"],
        task_count=raw["task_count"],
        backends_included=raw["backends_included"],
    )


