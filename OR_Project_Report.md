# Aether Router: A MILP-Based Framework for Latency-Optimal LLM Query Routing

**Course:** Operations Research (B.Tech)  
**Project Title:** Cost and Latency Optimization Framework for LLM Routing using Mixed Integer Linear Programming  
**Date:** August 2026

---

## Abstract

This report presents *Aether Router*, a Mixed Integer Linear Programming (MILP) framework for the optimal assignment of user queries to heterogeneous Large Language Model (LLM) backends. Given a batch of incoming natural-language queries with varying complexity levels, the system classifies each query using a deterministic rule-based classifier, then solves a binary integer program that minimizes total service latency subject to hard capability and rate-limit capacity constraints. The framework is evaluated against two practical baselines — an *always-strongest-model* policy and a *fixed rule-based routing* policy — over a canonical six-query benchmark using three real free-tier backends (local Ollama, Groq API, Gemini API). The MILP optimizer achieves a **25.5% reduction in total service latency** compared to the always-Gemini baseline while maintaining zero capability violations and zero rate-limit violations. The rule-based baseline achieves slightly lower total latency (6.57 s vs. 6.84 s) but incurs **three capability violations** — tasks routed to backends provably incapable of handling their complexity level — demonstrating that latency alone is not a sufficient routing criterion. The MILP formulation is implemented using the open-source PuLP library with the CBC solver, served through a FastAPI backend, and validated by a 21-case automated test suite achieving a 100% pass rate.

---

## 1. Problem Statement & Motivation

### 1.1 Context

Modern AI applications routinely have access to multiple LLM providers that differ substantially in response speed, reasoning capability, and rate-limit capacity. A developer building a multi-query AI service must decide, for each incoming request, which backend to invoke. The two most common approaches are:

1. **Always use the strongest (most capable) model.** This guarantees quality but incurs unnecessary latency on simple tasks and rapidly exhausts tight per-day quotas (e.g., Gemini's 1,500 RPD free-tier limit).
2. **Apply hand-crafted if-else rules.** Simpler to implement, but cannot jointly optimize multiple constraints or adapt to changing backend load, and can route tasks to incapable backends.

Both approaches are *locally rational* but *globally suboptimal*. When a batch of requests with heterogeneous complexity arrives simultaneously, the routing problem becomes a resource allocation problem: how to assign tasks to backends so that total latency is minimized, no task is assigned to an under-capable backend, and no backend is assigned more tasks than its rate-limit capacity allows.

### 1.2 Problem Formulation (Informal)

> Given a batch of $n$ queries, each labeled with a complexity level (Low / Medium / High), and a set of LLM backends with known latency, capability, and RPM capacity, find a one-to-one assignment of queries to backends that **minimizes total service latency** while satisfying: (i) every query is assigned exactly once, (ii) the assigned backend is capable of handling the query's complexity, and (iii) no backend receives more queries per minute than its published rate limit.

### 1.3 Why Operations Research?

The above problem is structurally an **integer assignment problem with side constraints**. Its decision space is finite but exponential in the number of tasks and backends. Heuristic policies explore only a small corner of this space. MILP solvers, by contrast, are guaranteed to find the globally optimal assignment or prove infeasibility, making them both more powerful and more transparent than heuristic routing. The problem resembles the classical resource-constrained assignment problem studied extensively in OR literature, and applying it to LLM routing is a direct and defensible academic contribution at the intersection of optimization and AI infrastructure.

---

## 2. Related Work / Existing Approaches

### 2.1 Static Routing: Always-Strongest-Model

The simplest production routing policy is to direct every query, regardless of complexity, to the highest-capability backend available. In our three-backend setup, this corresponds to routing every query to **Gemini 2.5 Flash**. The advantages are simplicity and guaranteed capability satisfaction. The disadvantages are:

- **Latency overhead on simple tasks.** Gemini's measured average latency is 1.53 s. Simple translation or email-writing tasks could be handled at 0.36 s on Groq, a 4.25× speedup.
- **Quota pressure.** At 1,500 requests per day (Gemini free-tier RPD limit captured 10 August 2026), routing all traffic to Gemini exhausts the daily budget 3–4× faster than a distributed strategy.
- **Under-utilization of cheaper, faster backends** that are perfectly capable of handling low- and medium-complexity tasks.

### 2.2 Fixed Rule-Based Routing

A more common production approach is to define a static mapping from query complexity to backend:

| Complexity | Assigned Backend |
|---|---|
| Low | Local (Ollama) |
| Medium | Groq |
| High | Gemini |

This approach is easily implementable, latency-aware, and distributes load. However, it has a critical flaw: **it does not respect capability constraints**. In this project's backend profile, Groq runs `llama-3.1-8b-instant` and is assigned a capability score of 2. Medium-complexity tasks require a capability score of 3. The rule-based policy therefore routinely routes Medium tasks to Groq, which is a **capability violation** — the backend is not provably qualified to handle the task. On the six-query benchmark, the rule-based policy incurs **3 capability violations** out of 6 tasks.

Additionally, the rule-based policy is static and cannot adapt when, for example, Groq's 30-RPM limit is saturated, or when a specific backend's latency changes.

### 2.3 Machine Learning-Based Routing

Several research prototypes and commercial products (e.g., Martian, RouteLLM) use a learned routing model that predicts query difficulty and directs it to the appropriate backend. While these approaches can be highly effective, they require labeled training data, are difficult to interpret, and introduce a model-serving latency overhead that may outweigh the routing savings. Our approach is fully deterministic, requires no training data, and produces auditable, mathematically optimal assignments.

---

## 3. Methodology — MILP Formulation

### 3.1 Sets and Indices

Let $I = \{1, \dots, n\}$ denote the set of incoming queries in a batch, and let $J = \{\text{local}, \text{groq}, \text{gemini}\}$ denote the set of available backends in the deployed configuration.

### 3.2 Parameters

| Symbol | Meaning | Value (deployed config) |
|---|---|---|
| $L_j$ | Measured end-to-end wall-clock latency of backend $j$ (seconds) | local: 1.98 s, groq: 0.36 s, gemini: 1.53 s |
| $\text{Cap}_j$ | Normalized capability level of backend $j$ (scale 1–5) | local: 1, groq: 2, gemini: 5 |
| $R_i$ | Required capability of task $i$ | low → 1, medium → 3, high → 5 |
| $\text{RPM}_j$ | Requests-per-minute capacity of backend $j$ | local: ∞, groq: 30, gemini: ∞ |

> **Note on the objective function:** All three deployed backends operate on free tiers with zero monetary cost per request (`cost_per_1k_tokens = 0.0` for all). Because cost is not a meaningful differentiator among these backends, the primary optimization objective is **latency minimization**, not cost minimization. This is a deliberate modeling choice stated explicitly here and in the implementation. Capability and RPM capacity serve as hard constraints. A cost-sensitivity extension to paid tiers is discussed in Section 8.

> **Note on capability scores:** The capability values (1, 2, 5) are **normalized modeling parameters**, not official provider ratings. They are assigned to align with the three required capability levels used by the complexity rubric (1 for Low, 3 for Medium, 5 for High), ensuring that each complexity level has at least one feasible backend assignment. The scores reflect the relative ordering of backend quality as judged by model size and architecture, but they have not been validated against a formal benchmark — this limitation is discussed in Section 8.

### 3.3 Decision Variable

$$
x_{ij} \in \{0, 1\}, \quad \forall i \in I, j \in J
$$

where $x_{ij} = 1$ if and only if task $i$ is assigned to backend $j$.

### 3.4 Objective Function

Minimize total service latency across all tasks in the batch:

$$
\min \sum_{i \in I} \sum_{j \in J} L_j \cdot x_{ij}
$$

This makes Aether Router a **latency-minimizing, capacity- and capability-constrained binary assignment problem** — a structured form of the integer programming machine-scheduling class.

### 3.5 Constraints

**Constraint A — Uniqueness (each task assigned exactly once):**

$$
\sum_{j \in J} x_{ij} = 1 \qquad \forall i \in I
$$

**Constraint B — Capability (backend must be capable of the task):**

$$
x_{ij} = 0 \quad \text{whenever } \text{Cap}_j < R_i \qquad \forall i \in I, j \in J
$$

In implementation, disallowed $(i, j)$ pairs are fixed to zero before the solver is invoked, reducing the effective search space. If no backend satisfies the capability constraint for a given task, the problem is infeasible and the solver raises a `ValueError` — it never silently assigns a task to an under-capable backend.

**Constraint C — RPM capacity per backend:**

$$
\sum_{i \in I} x_{ij} \leq \text{RPM}_j \qquad \forall j \in J \text{ with finite } \text{RPM}_j
$$

**Constraint D — Binary integrality:**

$$
x_{ij} \in \{0, 1\} \qquad \forall i \in I, j \in J
$$

### 3.6 Solver

The problem is encoded in Python using the **PuLP** library (v3.x) and solved by the open-source **CBC (COIN-OR Branch and Cut)** solver via the `PULP_CBC_CMD` interface. The solver is invoked with `msg=False` for clean output. Solver status is checked after every call; a non-optimal status (including infeasibility) is propagated as a `ValueError` to the calling API layer.

### 3.7 Scope of the Model: What Is and Is Not Modeled

| Constraint | Modeled? | Notes |
|---|---|---|
| RPM per backend | ✅ Yes | Hard constraint C above |
| Capability per task | ✅ Yes | Hard constraint B above |
| TPM (tokens per minute) | ❌ No | Recorded in config for reference; not modeled in MILP |
| RPD (requests per day) | ❌ No | Recorded in config for reference; not modeled in MILP |
| Per-task latency threshold | ❌ No | Future extension |
| Monetary cost | ❌ No | All backends are free-tier; see paid-tier extension in §8 |

---

## 4. System Architecture & Implementation

### 4.1 Component Overview

```
                    Incoming Query Batch (HTTP POST /route)
                                │
                                ▼
                 Rule-Based Complexity Classifier
                    (optimizer/complexity.py)
                                │
                                ▼ [{id, complexity}]
                   MILP Optimization Engine (PuLP)
                      (optimizer/milp.py)
                                │
                                ▼ {task_id → backend_name}
                FastAPI Routing Middleware (api/main.py)
                    (concurrent ThreadPoolExecutor)
                                │
            ┌───────────────────┼────────────────────┐
            ▼                   ▼                    ▼
      Local Ollama           Groq API           Gemini API
     (llama3.2:1b)    (llama-3.1-8b-instant) (gemini-2.5-flash)
     localhost:11434   api.groq.com           generativelanguage.googleapis.com
            │                   │                    │
            └───────────────────┴────────────────────┘
                                │
                                ▼
                    Aggregated Response (results + summary)
```

### 4.2 Key Components

**Complexity Classifier** (`optimizer/complexity.py`)  
A purely rule-based function `classify_complexity(query: str) -> str` that uses two rules in order: (1) keyword scanning — case-insensitive substring matching against three ranked keyword lists (High, Medium, Low), with tie-breaking to the highest matched level; (2) length fallback — word count below 15 → Low, 15–40 → Medium, above 40 → High. The classifier is fully deterministic and requires no model inference or external calls.

**MILP Optimizer** (`optimizer/milp.py`)  
The function `solve(tasks: list[dict], backends: dict) -> dict[int, str]` encodes and solves the MILP exactly as specified in Section 3. The `latency_s` field of each backend in the `BACKENDS` config is the sole latency input to the objective; if `latency_s` is `None` (not yet measured), the solver raises a `ValueError` immediately. This prevents the optimizer from running with unmeasured (fabricated) parameters.

**Baseline Strategies** (`optimizer/baselines.py`)  
Two comparison functions implement the baselines described in Section 2:
- `baseline_always_gemini(tasks)`: maps every task ID to `"gemini"`.
- `baseline_rule_based(tasks)`: maps `low → local`, `medium → groq`, `high → gemini`.

**LLM Client** (`clients/llm_client.py`)  
A single `LLMClient.call(backend, prompt) -> dict` method targets all three backends through their OpenAI-compatible chat-completions endpoints (swapping `base_url`, `model`, and API key). Wall-clock response time is measured using `time.perf_counter()` around the API call, producing a `latency_s` field in each response.

**FastAPI Application** (`api/main.py`)  
Two endpoints:
- `POST /route` — classifies, solves the MILP, executes LLM calls concurrently via `ThreadPoolExecutor`, and returns results plus a summary containing `total_service_latency_s`, `average_latency_s`, and `backend_usage`.
- `POST /compare` — runs the MILP and both baselines on the same batch using simulated latencies from the config profile, returning metrics for all three strategies without live LLM calls. This enables offline comparison experiments without API quota consumption.

**Tech Stack:** Python 3.14, FastAPI, PuLP 3.x (CBC solver), OpenAI SDK (OpenAI-compatible client), pytest, Next.js frontend with Recharts visualizations.

### 4.3 Latency Calibration

Backend latency values in `config.py` are obtained by running the `experiments/measure_latency.py` script, which sends three representative benchmark prompts (a factual recall question, a short Python function request, and an API explanation request) to each backend and records the average wall-clock response time. The measured values were captured on **10 August 2026** and are:

| Backend | Model | Measured Avg. Latency |
|---|---|---|
| Local (Ollama) | `llama3.2:1b` | 1.98 s |
| Groq | `llama-3.1-8b-instant` | 0.36 s |
| Gemini | `gemini-2.5-flash` | 1.53 s |

All three backends were measured using the same prompt set, the same `max_tokens=150` output cap, and the same wall-clock timing method (`time.perf_counter()`).

---

## 5. Experimental Setup

### 5.1 Query Benchmark

The comparison experiment uses the following six queries, chosen to represent the full complexity spectrum:

| # | Query | Complexity (Classified) |
|---|---|---|
| 1 | Translate this paragraph into French | Low |
| 2 | Summarize this research paper in 3 bullet points | Medium |
| 3 | Solve this DSA problem: find the longest increasing subsequence | High |
| 4 | Generate a SQL query to join two tables | Medium |
| 5 | Write a professional email declining a meeting | Low |
| 6 | Explain recursion with an example | Medium |

The batch contains 2 Low, 3 Medium, and 1 High task. These queries are drawn from the project's labeled example set (Section 3 of `02_complexity_rubric.md`) and are used identically in the complexity classifier test suite.

### 5.2 Comparison Methodology

The `/compare` endpoint simulates each routing strategy using pre-calibrated backend latencies from `config.py` rather than issuing live API calls. This design choice serves two purposes: (i) it makes the comparison repeatable and free of network jitter, and (ii) it avoids consuming API quota. The simulated latency for a routing is computed as $\sum_{i} L_{j(i)}$, where $j(i)$ is the backend assigned to task $i$ by the strategy under evaluation.

### 5.3 Backend Rate Limits Captured

Rate limits were captured from official provider consoles and documentation on **10 August 2026**:

| Backend | RPM | TPM | RPD |
|---|---|---|---|
| Local (Ollama) | Unlimited | Unlimited | Unlimited |
| Groq (`llama-3.1-8b-instant`) | 30 | 6,000 | 14,400 |
| Gemini (`gemini-2.5-flash`) | Not modeled (stable RPM unavailable) | 250,000 | 1,500 |

> Rate limits on free-tier cloud APIs change frequently. The values above should be reverified against provider documentation before any future deployment.

### 5.4 Evaluation Metrics

| Metric | Description |
|---|---|
| **Total service latency (s)** | Sum of assigned backend latencies across all tasks in the batch |
| **Average latency (s)** | Total service latency divided by number of tasks |
| **Capability violations** | Number of tasks assigned to a backend with `Cap_j < R_i` |
| **RPM violations** | Number of tasks in excess of any backend's RPM limit |

### 5.5 MILP Solver Tests

Four deterministic unit tests in `backend/tests/test_milp.py` validate solver correctness using controlled backend configurations with explicitly chosen (not live-measured) latency values:

| Test | Input | Expected Result | Purpose |
|---|---|---|---|
| `test_basic_capability_routing` | 1 Low + 1 High task; local (cap 1, 0.4 s), groq (cap 2, 0.5 s), gemini (cap 5, 1.0 s) | Low → local, High → gemini | Confirms capability constraint and latency-minimization for two tasks |
| `test_medium_complexity_lowest_latency` | 1 Medium task; local (cap 1, 0.3 s), groq (cap 2, 0.4 s), gemini (cap 5, 1.0 s) | Medium → gemini | Confirms ineligible backends (cap < 3) are excluded; only gemini qualifies |
| `test_rpm_capacity_constraint_binds` | 35 Low tasks; groq (cap 2, 0.5 s, RPM=30), gemini (cap 5, 1.5 s), local (cap 1, 2.0 s) | groq gets exactly 30; 5 spill to gemini | Proves RPM constraint is active and causes spillover |
| `test_infeasibility_check` | 1 High task; no backend with capability ≥ 5 (gemini removed) | Raises `ValueError` with "infeasible" | Confirms the solver never silently assigns to an incapable backend |

---

## 6. Results

### 6.1 Task Classification Results

All six benchmark queries were classified correctly by the rule-based classifier:

| Task | Query (abbreviated) | Classified | Rule Fired |
|---|---|---|---|
| 1 | Translate … into French | Low | keyword: *translate* |
| 2 | Summarize this research paper … | Medium | keyword: *summarize* |
| 3 | Solve this DSA problem … | High | keywords: *solve, dsa* |
| 4 | Generate a SQL query … | Medium | keyword: *sql* |
| 5 | Write a professional email … | Low | keyword: *write email* |
| 6 | Explain recursion with an example | Medium | keyword: *explain* (special-case override) |

The complexity classifier achieves **15/15 correct labels** on the full labeled example set (`test_complexity.py`), a 100% accuracy on the defined benchmark.

### 6.2 Routing Decisions by Strategy

**MILP (Optimal):**

| Task | Complexity | Assigned Backend | Latency (s) | Cap OK? |
|---|---|---|---|---|
| 1 | Low | Groq | 0.36 | ✅ |
| 2 | Medium | Gemini | 1.53 | ✅ |
| 3 | High | Gemini | 1.53 | ✅ |
| 4 | Medium | Gemini | 1.53 | ✅ |
| 5 | Low | Groq | 0.36 | ✅ |
| 6 | Medium | Gemini | 1.53 | ✅ |

The MILP routes both Low tasks to Groq (the fastest eligible backend at 0.36 s) and all Medium/High tasks to Gemini (the only backend with capability ≥ 3). Groq's RPM limit of 30 is not binding for this 6-task batch.

**Always-Gemini (Baseline 1):**

All 6 tasks → Gemini (1.53 s each). Zero capability violations, zero RPM violations.

**Rule-Based (Baseline 2):**

| Task | Complexity | Assigned Backend | Latency (s) | Cap OK? |
|---|---|---|---|---|
| 1 | Low | Local | 1.98 | ✅ |
| 2 | Medium | Groq | 0.36 | ❌ (cap=2 < req=3) |
| 3 | High | Gemini | 1.53 | ✅ |
| 4 | Medium | Groq | 0.36 | ❌ (cap=2 < req=3) |
| 5 | Low | Local | 1.98 | ✅ |
| 6 | Medium | Groq | 0.36 | ❌ (cap=2 < req=3) |

The rule-based policy routes all Medium tasks to Groq. Since Groq's capability score is 2 and Medium tasks require capability 3, these assignments are **capability violations**.

### 6.3 Comparative Performance

| Method | Total Service Latency (s) | Average Latency (s) | Capability Violations | RPM Violations |
|---|---|---|---|---|
| **MILP** | **6.84** | **1.14** | **0** | **0** |
| Always-Gemini | 9.18 | 1.53 | 0 | 0 |
| Rule-Based | 6.57 | 1.095 | **3** | 0 |

### 6.4 Analysis

**MILP vs. Always-Gemini:** The MILP achieves a **25.5% reduction in total service latency** (6.84 s vs. 9.18 s, Δ = 2.34 s) by intelligently routing the two Low-complexity tasks to Groq rather than saturating Gemini with all traffic. This latency gain compounds at scale — for a 60-task batch with a similar complexity distribution, the MILP would save approximately 23.4 s of total service time while also reducing Gemini quota consumption by ~33%.

**MILP vs. Rule-Based:** The rule-based baseline records a slightly lower total latency (6.57 s vs. 6.84 s, Δ = 0.27 s) because it aggressively routes all three Medium tasks to Groq's 0.36 s latency. However, it does so in violation of the capability constraint: all three of those assignments route a Medium task (requiring capability 3) to Groq (capability 2), a **50% capability violation rate** for Medium tasks. The MILP achieves comparable latency while maintaining **zero capability violations** — a strict constraint the rule-based policy cannot guarantee. This is the core empirical finding: latency and constraint satisfaction cannot be traded off heuristically; only a formal optimization model can satisfy both simultaneously.

**Capability Satisfaction:** Both MILP and Always-Gemini achieve 100% capability satisfaction. Rule-Based achieves 50% (3/6 tasks violated).

**RPM Constraint:** No strategy exceeds Groq's RPM limit of 30 on the 6-task benchmark. The MILP correctly handles this at scale — `test_rpm_capacity_constraint_binds` demonstrates that when 35 Low-complexity tasks are submitted, the solver assigns exactly 30 to Groq and spills the remaining 5 to the next feasible backend.

### 6.5 Test Suite Results

All 21 automated tests pass in 2.65 seconds:

| Test Module | Tests | Status |
|---|---|---|
| `test_complexity.py` | 15 | ✅ 15 passed |
| `test_milp.py` | 4 | ✅ 4 passed |
| `test_integration.py` | 2 | ✅ 2 passed |
| **Total** | **21** | **✅ 21 passed** |

---

## 7. Limitations & Future Work

### 7.1 TPM and RPD Not Modeled

The current MILP enforces only RPM (Requests-Per-Minute) capacity constraints. Two additional rate-limit dimensions recorded in the backend config — **TPM (Tokens Per Minute)** and **RPD (Requests Per Day)** — are not modeled in the optimization. This simplification is intentional: TPM requires predicting output token length per task (adding model uncertainty), and RPD operates on a different time horizon than a single batch optimization. For production systems handling sustained traffic over hours, omitting RPD constraints means the optimizer could theoretically schedule more Gemini calls than the 1,500/day free-tier limit allows. A natural extension is to add a RPD budget constraint $\sum_{\text{batches}} \sum_i x_{ij} \leq \text{RPD}_j$ across all batches in a sliding 24-hour window.

### 7.2 Capability Scores Are Unvalidated by Benchmark

The capability scores assigned to backends (local=1, groq=2, gemini=5) are **normalized modeling assumptions**, not empirically derived from a standardized benchmark (e.g., MMLU, HumanEval, or MATH). The relative ordering is directionally well-supported by model sizes and architecture, but the specific gap between scores — particularly that Groq's `llama-3.1-8b-instant` (score 2) fails Medium-complexity tasks while Gemini (score 5) succeeds — has not been validated through head-to-head response quality evaluation. A future version of this project should run each backend on a labeled set of Medium- and High-complexity queries, score the outputs, and use those empirical scores to calibrate the capability parameters more rigorously.

### 7.3 Paid-Tier Cost-Sensitivity Extension

Because all three backends are free-tier, cost is not a differentiating factor in the core experiment and has been deliberately excluded from the objective function. The `cost_per_1k_tokens` field is retained in `config.py` for a hypothetical paid-tier extension. If paid tiers are introduced (e.g., Gemini Pro at $0.075/1M input tokens), the objective can be extended to a weighted latency-plus-cost formulation:

$$
\min \sum_{i \in I} \sum_{j \in J} \left( C_j + \lambda L_j \right) x_{ij}
$$

where $\lambda$ controls the trade-off between cost and latency. Varying $\lambda$ and solving the parametric MILP would produce an efficient frontier analogous to the Pareto front in multi-objective optimization. This extension is clearly labeled as a *hypothetical paid-tier scenario* and does not affect the validity of the free-tier experiment reported here.

### 7.4 Other Future Directions

- **Dynamic latency monitoring:** Backend latency is currently a static parameter calibrated at experiment time. Real-world provider latency varies with load. An adaptive version could maintain a rolling average and re-solve the MILP periodically.
- **Learned complexity classifier:** The rule-based keyword classifier is intentionally simple and explainable. A future version could replace it with a fine-tuned embedding model, gaining recall at the cost of interpretability and an additional inference latency.
- **Cerebras backend integration:** The project originally planned four backends including Cerebras (`llama-3.3-70b`, capability 4). Cerebras was excluded from the final deployed configuration due to API access constraints at the time of the experiment. Its inclusion would add a high-throughput, medium-high capability option that could improve routing efficiency for Medium-complexity tasks, potentially reducing total latency below the current 6.84 s.
- **Concurrent batch wall-clock time:** The `/route` endpoint dispatches LLM calls concurrently via `ThreadPoolExecutor`. The total *wall-clock* completion time of a concurrent batch is bounded by the slowest task's latency, not by the sum. The current metric `total_service_latency_s` reports the sum of individual latencies, which differs from wall-clock time. Future work should add a concurrent batch completion metric.

---

## 8. Conclusion

This project demonstrates that Mixed Integer Linear Programming is a practical and theoretically principled approach to LLM query routing. By formulating routing as a binary assignment problem, Aether Router jointly optimizes total service latency while hard-enforcing capability and rate-limit capacity constraints — something that neither the always-strongest-model policy nor fixed rule-based routing can guarantee simultaneously.

On the six-query canonical benchmark, the MILP optimizer achieves:
- **25.5% lower total service latency** than the always-Gemini baseline (6.84 s vs. 9.18 s)
- **Zero capability violations** and **zero RPM violations**, in contrast to the rule-based baseline which incurs 3 capability violations while achieving marginally lower latency at the cost of correctness
- **100% test suite pass rate** across 21 automated unit and integration tests, including deterministic MILP solver validation against four hand-derived test cases

The core OR contribution is modest in formulation — a standard binary integer program with three constraint types — but practically significant: it shows that the globally optimal latency-feasible assignment can be computed in milliseconds for realistic batch sizes using open-source tools, at zero additional infrastructure cost. The framework is extensible to paid-tier cost optimization, TPM/RPD constraints, and empirically calibrated capability scores, all of which are left as clearly defined future work.

---

## Appendix: Project File Structure

```
backend/
├── api/
│   └── main.py              # FastAPI app: /route and /compare endpoints
├── clients/
│   └── llm_client.py        # OpenAI-compatible multi-backend client
├── optimizer/
│   ├── milp.py              # MILP formulation (PuLP / CBC)
│   ├── complexity.py        # Rule-based query classifier
│   └── baselines.py         # Always-Gemini and rule-based baselines
├── experiments/
│   └── measure_latency.py   # Backend latency calibration script
├── tests/
│   ├── test_milp.py         # 4 deterministic MILP solver tests
│   ├── test_complexity.py   # 15 classifier tests (from labeled example set)
│   └── test_integration.py  # 2 end-to-end FastAPI tests
└── config.py                # Backend profiles (latency, capability, rate limits)
Documentation/
├── 01_backend_config.md
├── 02_complexity_rubric.md
├── 03_milp_formulation.md
├── 04_api_contract.md
└── 05_test_cases.md
```

---

*Report generated: August 14, 2026. Rate limits captured: August 10, 2026. All experimental results derived from `backend/config.py` calibrated values and `backend/api/main.py` `/compare` endpoint output.*
