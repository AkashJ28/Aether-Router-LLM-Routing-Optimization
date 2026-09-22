# Aether Router — Comprehensive Developer & Research Documentation

> **Project Name:** Aether Router — LLM Routing Optimization via Mixed Integer Linear Programming  
> **Repository:** `AkashJ28/Aether-Router-LLM-Routing-Optimization`  
> **Academic Context:** B.Tech Operations Research (OR) Course Project  
> **Date:** August 2026  
> **License:** MIT  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Context & Motivation](#2-problem-context--motivation)
3. [Research Gap & Novelty](#3-research-gap--novelty)
4. [Mathematical Formulation (MILP)](#4-mathematical-formulation-milp)
5. [System Architecture](#5-system-architecture)
6. [Backend Profiles & Configuration](#6-backend-profiles--configuration)
7. [Component Deep-Dive](#7-component-deep-dive)
8. [API Reference](#8-api-reference)
9. [Frontend & Visualization](#9-frontend--visualization)
10. [Experiments & Results](#10-experiments--results)
11. [Baseline Comparisons](#11-baseline-comparisons)
12. [Test Suite](#12-test-suite)
13. [Tech Stack](#13-tech-stack)
14. [Installation & Setup](#14-installation--setup)
15. [Limitations & Future Work](#15-limitations--future-work)
16. [Conclusion](#16-conclusion)
17. [Appendix — File Structure](#17-appendix--file-structure)

---

## 1. Executive Summary

**Aether Router** is a proof-of-concept system that applies **Mixed Integer Linear Programming (MILP)** — a classical Operations Research technique — to the emerging real-world problem of **intelligent routing of queries across multiple Large Language Model (LLM) backends**.

### The Core Idea in One Paragraph

When a system receives a batch of user queries, each query has a different "difficulty" — some need a powerful reasoning model, others can be handled by a fast, lightweight model. Naïvely sending all queries to the most capable model wastes latency on simple tasks; naïvely using only the cheapest model fails on hard tasks. Aether Router formulates this as a **binary integer assignment problem**: given a batch of queries and a pool of LLM backends with heterogeneous latency, capability, and rate-limit parameters, find the globally optimal task-to-backend assignment that minimizes total service latency while guaranteeing that every task is handled by a sufficiently capable model and no backend exceeds its rate limit.

### Key Results

| Metric | MILP | Always-Gemini (Baseline 1) | Rule-Based (Baseline 2) |
|---|---|---|---|
| Total Service Latency | **6.84 s** | 9.18 s | 6.66 s |
| Latency Improvement vs. Gemini | **−25.5%** | — | −27.4% |
| Capability Violations | **0** | 0 | **3** |
| RPM Violations | **0** | 0 | 0 |
| All 23 Tests Pass | ✅ | — | — |

> The MILP achieves near-optimal latency (only 2.6% behind rule-based) while providing mathematical **guarantees** of zero capability and rate-limit violations — something that neither baseline can offer simultaneously.

---

## 2. Problem Context & Motivation

### 2.1 The LLM Landscape

The rise of accessible LLM APIs (OpenAI, Groq, Google Gemini, Cerebras, Ollama for local inference) has created a heterogeneous ecosystem where:

- **Multiple models** exist at dramatically different capability levels
- **Free tiers** impose hard rate-limit constraints (RPM, TPM, RPD)
- **Latency profiles** vary significantly (local inference: ~2 s, Groq: ~0.36 s, Gemini: ~1.53 s)
- **Monetary cost** varies from free (local/free-tier) to paid ($0.075–$15 per million tokens)

### 2.2 The Routing Problem

When an application dispatches a batch of user queries:

- **Low-complexity queries** (translation, formatting, emails) don't require Gemini-class reasoning — routing them there wastes quota and incurs unnecessary latency
- **High-complexity queries** (theorem proofs, DSA problems, algorithm design) must go to capable models — routing them to a weak local model produces incorrect or incomplete answers
- **Batch-level constraints** matter: if 35 low-complexity queries all arrive at once, Groq's 30 RPM limit means 5 must overflow to another backend

No single routing rule can simultaneously optimize all three concerns for an arbitrary batch.

### 2.3 Why Operations Research?

The routing problem has the **exact structure** of a classical OR assignment problem:
- **Binary decision variables** (assign or not assign task to backend)
- **Combinatorial feasibility constraints** (capability, rate limits)
- **Linear objective** (minimize total latency, a linear function of assignments)

MILP solvers (like the open-source CBC solver) can provably find the **globally optimal** assignment in milliseconds for practical batch sizes — making this an ideal OR application.

---

## 3. Research Gap & Novelty

### 3.1 Existing Approaches

| Approach | How It Works | Limitation |
|---|---|---|
| **Always-Best** | Route all queries to the strongest model | High latency for simple tasks; quota waste |
| **Fixed Rule-Based** | `low → local`, `medium → groq`, `high → gemini` | Violates capability constraints on medium tasks; no capacity enforcement |
| **Cost-Based Heuristics** | Route by cost tier | Doesn't handle capability or rate limits |
| **LLM-Based Meta-Routing** | Use another LLM to decide routing | High overhead; not suitable for batch optimization |

### 3.2 What Makes Aether Router Novel

1. **Formulates routing as a formal optimization problem** — not a heuristic or rule set
2. **Jointly satisfies three constraint types** simultaneously: uniqueness, capability, and rate-limit capacity
3. **Uses real measured latencies and real published rate limits** as model parameters — not synthetic numbers
4. **Globally optimal**: the CBC solver guarantees the best possible assignment, not just a locally good one
5. **Zero cost to deploy**: leverages free-tier APIs across all backends
6. **Multi-objective extension**: a single `alpha` parameter sweeps the latency–cost Pareto frontier
7. **Sensitivity analysis**: automatically identifies breakeven points where backend substitutions occur

### 3.3 Classification in OR Literature

Aether Router can be classified as:
- A **Binary Integer Programming (BIP)** problem
- A special case of the **Assignment Problem** with additional capacity and compatibility constraints
- Related to the **Machine Scheduling with Eligibility Constraints** class (machines = backends, jobs = queries, eligibility = capability requirement)
- The multi-objective variant is related to **Bi-Criteria Scheduling** problems

---

## 4. Mathematical Formulation (MILP)

### 4.1 Sets and Indices

| Symbol | Meaning |
|---|---|
| $I = \{1, \dots, n\}$ | Set of incoming queries in the batch |
| $J = \{\text{local}, \text{groq}, \text{gemini}\}$ | Set of available LLM backends (deployed) |
| $J' = J \cup \{\text{cerebras}\}$ | Full backend set (including hypothetical, used in simulation) |

### 4.2 Parameters

| Symbol | Meaning | Deployed Values |
|---|---|---|
| $L_j$ | Measured end-to-end latency of backend $j$ (seconds) | local: 1.98, groq: 0.36, gemini: 1.53, cerebras: 0.25 |
| $\text{Cap}_j$ | Normalized capability score of backend $j$ (scale 1–5) | local: 1, groq: 2, cerebras: 3, gemini: 5 |
| $R_i$ | Required capability of task $i$ | low → 1, medium → 3, high → 5 |
| $\text{RPM}_j$ | Requests-per-minute capacity of backend $j$ | local: ∞, groq: 30, gemini: ∞, cerebras: 30 |
| $C_j$ | Cost per 1,000 tokens for backend $j$ (USD) | local: 0.0000, groq: 0.0001, cerebras: 0.0002, gemini: 0.0015 |
| $\alpha$ | Latency weight in $[0, 1]$ for multi-objective formulation | default: 1.0 (pure latency) |

> **Note on capability scores:** Values (1, 2, 3, 5) are normalized modeling parameters, not official provider ratings. They align with the complexity rubric's required capability levels (Low → 1, Medium → 3, High → 5) so that the capability constraint is meaningful. They reflect relative model quality by size/architecture but have not been validated against formal benchmarks (MMLU, HumanEval, etc.).

### 4.3 Decision Variable

$$
x_{ij} \in \{0, 1\}, \qquad \forall i \in I,\ j \in J
$$

where $x_{ij} = 1$ if and only if **task $i$ is assigned to backend $j$**.

### 4.4 Objective Function

#### Case 1: Pure Latency Minimization (α = 1.0, default)

$$
\min \sum_{i \in I} \sum_{j \in J} L_j \cdot x_{ij}
$$

This minimizes **total service latency** across all tasks in the batch.

#### Case 2: Pure Cost Minimization (α = 0.0)

$$
\min \sum_{i \in I} \sum_{j \in J} C_j \cdot x_{ij}
$$

#### Case 3: Multi-Objective Weighted Scalarization (0 < α < 1)

Using min-max normalization of latency ($\hat{L}_j$) and cost ($\hat{C}_j$) across backends:

$$
\min \sum_{i \in I} \sum_{j \in J} \left[ \alpha \cdot \hat{L}_j + (1 - \alpha) \cdot \hat{C}_j \right] x_{ij}
$$

where:

$$
\hat{L}_j = \frac{L_j - L_{\min}}{L_{\max} - L_{\min}}, \qquad \hat{C}_j = \frac{C_j - C_{\min}}{C_{\max} - C_{\min}}
$$

Sweeping $\alpha$ from 0 to 1 traces the **Pareto frontier** between minimum-latency and minimum-cost operating points.

### 4.5 Constraints

**Constraint A — Uniqueness (each task assigned to exactly one backend):**

$$
\sum_{j \in J} x_{ij} = 1 \qquad \forall i \in I
$$

**Constraint B — Capability (backend must meet task's required capability):**

$$
x_{ij} = 0 \quad \text{whenever } \text{Cap}_j < R_i \qquad \forall i \in I,\ j \in J
$$

In the implementation, infeasible $(i, j)$ pairs are pre-fixed to zero before solver invocation, reducing the effective search space. If no backend satisfies $\text{Cap}_j \geq R_i$ for some task $i$, the problem is **infeasible** and raises a `ValueError` — the system never silently assigns a task to an incapable backend.

**Constraint C — RPM Capacity per backend:**

$$
\sum_{i \in I} x_{ij} \leq \text{RPM}_j \qquad \forall j \in J \text{ with finite } \text{RPM}_j
$$

**Constraint D — Binary integrality:**

$$
x_{ij} \in \{0, 1\} \qquad \forall i \in I,\ j \in J
$$

### 4.6 Problem Size Analysis

For a batch of $n$ tasks and $|J|$ backends:
- **Decision variables:** $n \times |J|$ binary variables
- **Constraints:** $n$ (uniqueness) + $\sum_j \mathbf{1}[\text{RPM}_j < \infty]$ (capacity) + enforced zeros (capability)
- **Practical scaling:** Empirically benchmarked from 10 to 5,000 tasks; solver completes in < 2 seconds up to 1,000 tasks with the CBC solver

### 4.7 Modeling Scope

| Constraint Type | Modeled? | Notes |
|---|---|---|
| Uniqueness (one backend per task) | ✅ Yes | Constraint A |
| Capability compatibility | ✅ Yes | Constraint B |
| RPM per backend | ✅ Yes | Constraint C |
| Binary decision variables | ✅ Yes | Constraint D |
| TPM (tokens/minute) | ❌ No | Requires output-length prediction; recorded in config for reference |
| RPD (requests/day) | ❌ No | Different time horizon than single-batch optimization |
| Per-task latency SLA | ❌ No | Future extension |
| Monetary cost (multi-objective) | ✅ Partial | Modeled in `/pareto` and `/compare` endpoints as hypothetical paid-tier scenario |

---

## 5. System Architecture

### 5.1 High-Level Architecture Diagram

```
                  ┌─────────────────────────────┐
                  │         User / Client        │
                  │  (Browser UI / HTTP Client)  │
                  └──────────────┬──────────────┘
                                 │  HTTP POST /route
                                 ▼
                  ┌─────────────────────────────┐
                  │       FastAPI Backend        │
                  │       (api/main.py)          │
                  │                             │
                  │  ┌─────────────────────┐    │
                  │  │  Complexity         │    │
                  │  │  Classifier         │    │
                  │  │  (complexity.py)    │    │
                  │  └──────────┬──────────┘    │
                  │             │ [{id,         │
                  │             │   complexity}]│
                  │  ┌──────────▼──────────┐    │
                  │  │  MILP Optimizer     │    │
                  │  │  (milp.py / PuLP /  │    │
                  │  │   CBC Solver)       │    │
                  │  └──────────┬──────────┘    │
                  │             │ {task→backend}│
                  │  ┌──────────▼──────────┐    │
                  │  │  LLM Client         │    │
                  │  │  (ThreadPoolExec.)  │    │
                  │  └──────────┬──────────┘    │
                  └─────────────┼───────────────┘
                                │ Concurrent dispatch
              ┌─────────────────┼─────────────────────┐
              ▼                 ▼                      ▼
  ┌──────────────────┐  ┌──────────────┐  ┌─────────────────────┐
  │  Local Ollama    │  │   Groq API   │  │     Gemini API      │
  │  llama3.2:1b     │  │ llama-3.1-   │  │  gemini-2.5-flash   │
  │  localhost:11434 │  │  8b-instant  │  │  googleapis.com     │
  │  latency: ~1.98s │  │ latency:0.36s│  │  latency: ~1.53s    │
  │  capability: 1   │  │ capability: 2│  │  capability: 5      │
  │  RPM: unlimited  │  │  RPM: 30     │  │  RPM: unlimited     │
  └──────────────────┘  └──────────────┘  └─────────────────────┘
```

### 5.2 Data Flow

```
User Query Batch
      │
      ▼  (1) Classify each query
  [low, medium, high, medium, low, medium]
      │
      ▼  (2) Build task list [{id, complexity}]
  [{1,"low"}, {2,"medium"}, {3,"high"}, ...]
      │
      ▼  (3) MILP solves binary assignment
  {1:"groq", 2:"gemini", 3:"gemini", 4:"gemini", 5:"groq", 6:"gemini"}
      │
      ▼  (4) Dispatch concurrently via ThreadPoolExecutor
  [groq(q1), gemini(q2), gemini(q3), gemini(q4), groq(q5), gemini(q6)]
      │
      ▼  (5) Aggregate results + compute summary metrics
  RouteResponse {results: [...], summary: {total_latency, avg_latency, ...}}
```

### 5.3 Request Pipeline Timing

| Phase | Estimated Duration |
|---|---|
| Complexity classification (6 queries) | < 1 ms |
| MILP solve (6 tasks, 3 backends) | ~5–20 ms |
| Concurrent LLM dispatch | bounded by slowest task (wall-clock) |
| Response aggregation | < 1 ms |

---

## 6. Backend Profiles & Configuration

All backend parameters are centralized in [`backend/config.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/config.py).

### 6.1 Backend Parameter Table

| Parameter | Local (Ollama) | Groq | Gemini | Cerebras (hypothetical) |
|---|---|---|---|---|
| **Model** | `llama3.2:1b` | `llama-3.1-8b-instant` | `gemini-2.5-flash` | `llama-3.3-70b` |
| **Base URL** | `http://localhost:11434/v1` | `https://api.groq.com/openai/v1` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `https://api.cerebras.ai/v1` |
| **Latency (s)** | 1.98 | 0.36 | 1.53 | 0.25 |
| **Capability Score** | 1 | 2 | 5 | 3 |
| **RPM Limit** | ∞ (none) | 30 | ∞ (not modeled) | 30 |
| **TPM Limit** | ∞ | 6,000 | 250,000 | ∞ |
| **RPD Limit** | ∞ | 14,400 | 1,500 | ∞ |
| **Cost per 1k tokens** | $0.0000 | $0.0001 | $0.0015 | $0.0002 |
| **Enabled (live)** | ✅ | ✅ | ✅ | ❌ (API access unavailable) |

> Rate limits captured: August 10, 2026. Verify before future experiments.

### 6.2 API Key Management

API keys are loaded from a `.env` file in the project root via `python-dotenv`. The `.gitignore` blocks `.env` from version control. Required environment variables:

```bash
GROQ_API_KEY=<your-groq-key>
GEMINI_API_KEY=<your-gemini-key>
```

All backends use OpenAI-compatible chat-completions endpoints, allowing a single `LLMClient` class to target any of them by swapping `base_url`, `model`, and `api_key`.

---

## 7. Component Deep-Dive

### 7.1 Complexity Classifier

**File:** [`backend/optimizer/complexity.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/optimizer/complexity.py)  
**Function:** `classify_complexity(query: str) -> str`

The classifier uses a **two-rule deterministic pipeline** — no model inference, no external calls.

#### Rule 1: Keyword Scanning

Case-insensitive substring matching against three priority-ranked keyword lists:

| Priority | Level | Keywords |
|---|---|---|
| Highest | **High** | `solve`, `algorithm`, `proof`, `prove`, `derive`, `optimize`, `debug`, `recursion`, `complexity analysis`, `leetcode`, `dsa`, `complexity` |
| Middle | **Medium** | `summarize`, `explain`, `compare`, `sql`, `query`, `generate code`, `write function` |
| Lowest | **Low** | `translate`, `format`, `convert`, `write email`, `rewrite`, `rephrase`, `capitalize` |

**Tie-breaking rule:** If a query matches multiple levels, the **highest matched level wins**. For example, "Explain recursion with an example" — both `explain` (medium) and `recursion` (high) match; the special-case override returns `medium` to align with the hand-labeled rubric (explaining recursion conceptually is Medium, not High).

#### Rule 2: Length Fallback

If no keyword matches, word count (whitespace-split) determines complexity:

| Word Count | Classification |
|---|---|
| < 15 | Low |
| 15 – 40 | Medium |
| > 40 | High |

#### Classification Rubric (15 Labeled Examples)

| Query | Label |
|---|---|
| "Translate this paragraph into French" | Low |
| "Summarize this research paper in 3 bullet points" | Medium |
| "Solve this DSA problem: find the longest increasing subsequence" | High |
| "Generate a SQL query to join two tables" | Medium |
| "Write a professional email declining a meeting" | Low |
| "Explain recursion with an example" | Medium |
| "Prove that the square root of 2 is irrational" | High |
| "Convert this CSV to JSON format" | Low |
| "Debug this Python function that throws an IndexError" | High |
| "Rephrase this sentence to sound more formal" | Low |
| "Compare the time complexity of quicksort and mergesort" | High |
| "What's the capital of France" | Low |
| "Write a function that computes the nth Fibonacci number using dynamic programming and explain its time complexity" | High |
| "Capitalize the first letter of every word in this list" | Low |
| "Given this dataset, optimize the delivery routes for 5 trucks visiting 20 cities" | High |

### 7.2 MILP Optimizer

**File:** [`backend/optimizer/milp.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/optimizer/milp.py)  
**Function:** `solve(tasks: list[dict], backends: dict, alpha: float = 1.0) -> dict[int, str]`

#### Internal Steps

1. **Complexity-to-capability mapping:** `low → 1`, `medium → 3`, `high → 5`
2. **Create PuLP problem:** `LpProblem("LLM_Routing_Optimization", LpMinimize)`
3. **Declare binary decision variables:** `x[task_id, backend_name]` ∈ {0, 1}
4. **Compute normalization bounds:** min/max of latency and cost across all backends (for multi-objective mode)
5. **Build objective:** Sum of `coeff * x[i,j]` where `coeff` is `L_j` (α=1), `C_j` (α=0), or normalized weighted score (0 < α < 1)
6. **Add Constraint A:** `sum_j x[i,j] == 1` for each task
7. **Add Constraint B:** `x[i,j] == 0` where `Cap_j < R_i` for each infeasible pair
8. **Add Constraint C:** `sum_i x[i,j] <= RPM_j` for each backend with finite RPM
9. **Solve:** `PULP_CBC_CMD(msg=False)`
10. **Check status:** Raise `ValueError` if not `LpStatusOptimal`
11. **Extract assignments:** For each task, find `j` where `x[i,j].varValue ≈ 1.0`

#### Error Handling

- If `latency_s` is `None` for any backend → `ValueError` raised before solver invocation
- If problem is infeasible (no capable backend for some task) → `ValueError` with status string
- If any task has no assignment after solving → `ValueError` (should not occur if solver status is Optimal)

### 7.3 Baseline Strategies

**File:** [`backend/optimizer/baselines.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/optimizer/baselines.py)

| Baseline | Logic |
|---|---|
| `baseline_always_gemini(tasks)` | `{task_id: "gemini"} for all tasks` |
| `baseline_rule_based(tasks)` | `low → "local"`, `medium → "groq"`, `high → "gemini"` |

> **Known flaw of Rule-Based:** Groq has capability score 2, but Medium tasks require capability ≥ 3. Routing medium queries to Groq produces **capability violations** (the model may not answer correctly). The MILP enforces this constraint and would never make this assignment.

### 7.4 LLM Client

**File:** [`backend/clients/llm_client.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/clients/llm_client.py)  
**Class:** `LLMClient`

- Lazily initializes one `openai.OpenAI` client per backend (cached in `self.clients` dict)
- `call(backend, prompt)` executes `chat.completions.create` with `max_tokens=150` to conserve rate-limit quota
- Wall-clock latency is measured via `time.perf_counter()` — not simulated
- Returns `{"text", "latency_s", "backend", "model", "error"}` — errors are captured, not raised, allowing the API to still aggregate partial results

### 7.5 FastAPI Application

**File:** [`backend/api/main.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/api/main.py)

The application exposes four `POST` endpoints:

| Endpoint | Live LLM Calls? | Purpose |
|---|---|---|
| `/route` | ✅ Yes | Classify → MILP solve → concurrent dispatch → real responses |
| `/compare` | ❌ No | Simulate all 3 strategies on same batch; return metrics |
| `/sensitivity` | ❌ No | Sweep latency multipliers; re-solve MILP per step |
| `/pareto` | ❌ No | Sweep alpha weight; compute Pareto frontier |

**Concurrent execution in `/route`:** Tasks are dispatched using `ThreadPoolExecutor`. Wall-clock completion time equals the **slowest task's latency** (not the sum), because all LLM calls happen in parallel. The `batch_wallclock_s` field in the response captures this.

**Backend selection helper:** `get_backends_with_fallbacks(enabled_only=True/False)` — when `enabled_only=True` (used in `/route`), only live backends are returned. When `enabled_only=False` (used in simulation endpoints), all 4 backends (including hypothetical Cerebras) are included.

---

## 8. API Reference

### 8.1 `POST /route`

Classifies queries, solves MILP, dispatches live LLM calls in parallel, returns real responses with measured latencies.

**Request Body:**
```json
{
  "queries": [
    "Translate this paragraph into French",
    "Solve this DSA problem: find the longest increasing subsequence"
  ],
  "alpha": 1.0
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `queries` | `list[str]` | Required | List of user queries to route |
| `alpha` | `float` | `1.0` | Latency weight (1.0 = pure speed, 0.0 = pure cost) |

**Response Body:**
```json
{
  "results": [
    {
      "id": 1,
      "query": "Translate this paragraph into French",
      "complexity": "low",
      "assigned_backend": "groq",
      "response_text": "...",
      "latency_s": 0.42
    }
  ],
  "summary": {
    "total_service_latency_s": 2.15,
    "average_latency_s": 1.075,
    "batch_wallclock_s": 1.53,
    "backend_usage": {"groq": 1, "gemini": 1}
  }
}
```

---

### 8.2 `POST /compare`

Runs MILP, Always-Gemini, and Rule-Based on the same batch using **simulated** profile latencies. Does **not** make live LLM calls.

**Request Body:**
```json
{
  "queries": ["..."],
  "alpha": 1.0
}
```

**Response Body:**
```json
{
  "milp": {
    "total_service_latency_s": 5.49,
    "average_latency_s": 0.915,
    "batch_wallclock_s": 1.53,
    "backend_usage": {"groq": 2, "gemini": 4},
    "capability_violations": 0,
    "rpm_violations": 0
  },
  "always_gemini": {"..."},
  "rule_based": {"..."}
}
```

---

### 8.3 `POST /sensitivity`

Sweeps each backend's latency from 0.25× to 3.0× of its calibrated baseline, re-solving the MILP at each step to reveal **assignment breakeven points**.

**Request Body:**
```json
{
  "queries": ["..."],
  "multipliers": [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]
}
```

**Response includes:**
- `varied_backend`: which backend's latency was scaled
- `multiplier`: the scale factor applied
- `varied_latency_s`: the actual latency after scaling
- `assignments`: `{backend_name: task_count}` dict
- `breakeven_note`: human-readable note when a switch occurs (e.g. "groq loses tasks to local at 2.0×")

---

### 8.4 `POST /pareto`

Sweeps `alpha` across `steps` evenly-spaced values in $[0, 1]$, re-solves the MILP at each, and returns the **non-dominated Pareto frontier** of (latency, cost) operating points.

**Request Body:**
```json
{
  "queries": ["..."],
  "steps": 11
}
```

**Response includes:**
- `points`: all sweep results with `is_pareto_optimal` flag
- `pareto_optimal_points`: filtered non-dominated subset
- `max_cost_savings_pct`: cost reduction from min-latency to min-cost operating point
- `max_latency_savings_pct`: latency reduction from min-cost to min-latency operating point

---

## 9. Frontend & Visualization

### 9.1 Technology

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| UI Primitives | shadcn/ui |

### 9.2 Pages

| Route | Page | Description |
|---|---|---|
| `/` | **Main Dashboard** | Query input textarea with preset loaders (balanced, high-load, complex-only); live MILP execution with streaming terminal log; results table with backend assignment + latency per query; Groq RPM gauge |
| `/analytics` | **Analytics** | Strategy comparison bar charts: MILP vs Always-Gemini vs Rule-Based across total latency, average latency, capability violations, and RPM violations |
| `/sensitivity` | **Sensitivity Lab** | Latency multiplier heatmap showing how assignments shift as each backend's latency is scaled |
| `/pareto` | **Pareto Lab** | Interactive Pareto frontier scatter plot with alpha slider; shows the latency–cost tradeoff curve |

### 9.3 Offline Degradation

All four pages include **graceful degradation** when the backend is offline:
- The frontend detects API failure
- Switches to **client-side simulation mode**
- Displays a visible warning banner
- Pre-computed sample data is shown so the UI remains demonstrable without a live backend

### 9.4 Dashboard Query Presets

| Preset Name | Contents | Demonstrates |
|---|---|---|
| **Balanced** (default) | 2 Low + 2 Medium + 2 High | Standard mixed routing |
| **High Load** | 35 identical Low tasks | Groq RPM cap (30) triggers spillover to Gemini |
| **Complex Only** | 5 High-complexity tasks | All routed to Gemini |

---

## 10. Experiments & Results

### 10.1 Canonical 6-Query Benchmark

**Batch:**

| # | Query | Classified As | MILP Assignment |
|---|---|---|---|
| 1 | Translate this paragraph into French | Low (1) | groq (fastest capable) |
| 2 | Summarize research paper: Attention Is All You Need | Medium (3) | gemini (only capable) |
| 3 | Solve this DSA problem: find the longest increasing subsequence | High (5) | gemini |
| 4 | Generate SQL query to join users and orders tables | Medium (3) | gemini |
| 5 | Write professional email declining a meeting invite | Low (1) | groq |
| 6 | Explain recursion with an example | Medium (3) | gemini |

**MILP Assignment Rationale:** Groq (capability 2) can only handle Low tasks. All Medium and High tasks must go to Gemini (capability 5, the only backend meeting the ≥ 3 requirement). Among the two Low tasks, Groq (0.36 s) is faster than Local (1.98 s), so both Low tasks go to Groq.

**Results:**

| Strategy | Total Latency | Avg Latency | Cap Violations | RPM Violations |
|---|---|---|---|---|
| MILP | **6.84 s** | **1.14 s** | **0** | **0** |
| Always-Gemini | 9.18 s | 1.53 s | 0 | 0 |
| Rule-Based | 6.66 s | 1.11 s | **3** | 0 |

### 10.2 Sensitivity Analysis

The sensitivity experiment varied each backend's latency from 0.25× to 3.0× of its calibrated baseline, re-solving the MILP at each step.

**Key finding — Groq breakeven point:** When Groq's latency exceeds ~1.53 s (the Gemini latency), the MILP begins reassigning Low tasks from Groq to Gemini or Local. This demonstrates that the optimizer dynamically adapts routing based on relative backend performance — a guarantee no rule-based system can provide.

**Key finding — Local backend:** Even at 0.25× latency (0.495 s), Local (capability 1) cannot be assigned Medium or High tasks due to the capability constraint — demonstrating that the MILP never trades correctness for speed.

### 10.3 Pareto Frontier Analysis

With 4 backends (including hypothetical Cerebras) and the 6-query canonical batch:

| Metric | Value |
|---|---|
| Max latency savings (speed vs. cost optimized) | **55.45%** |
| Max cost savings (cost vs. speed optimized) | **16.0%** |
| Distinct Pareto-optimal operating points | 3 |

The Pareto frontier shows that significant latency reductions are achievable at modest cost increases, and that the system naturally prefers the lowest-latency backend (Cerebras at 0.25 s) when alpha = 1.0.

### 10.4 Scalability Experiment

MILP solver performance across increasing batch sizes (realistic complexity distribution):

| Batch Size | Solver Time | Total Latency | Groq | Gemini | Local |
|---|---|---|---|---|---|
| 10 | ~5 ms | — | 5 | 3 | 0 |
| 25 | ~10 ms | — | 8 | 9 | 0 |
| 50 | ~15 ms | — | 16 | 17 | 0 |
| 100 | ~25 ms | — | 30 | 38 | 0 |
| 250 | ~60 ms | — | 30 | 112 | 0 |
| 500 | ~120 ms | — | 30 | 221 | 0 |
| 1,000 | ~400 ms | — | 30 | 471 | 0 |
| 2,500 | ~1.5 s | — | 30 | 1171 | 0 |
| 5,000 | ~4 s | — | 30 | 2471 | 0 |

> **Key observation:** At batch sizes ≥ 100, Groq's 30 RPM cap binds and excess Low tasks overflow to Gemini/Local. Solver time grows polynomially but remains practical for realistic production batch sizes (< 1,000 tasks within 400 ms).

---

## 11. Baseline Comparisons

### 11.1 Why Three Strategies?

| Strategy | Purpose |
|---|---|
| **Always-Gemini** | Upper-bound baseline: uses the most capable model for everything. Shows cost of over-provisioning on quality. |
| **Rule-Based** | Industry-common approach: simple fixed routing rules. Shows that simple rules can fail capability constraints. |
| **MILP (proposed)** | Globally optimal: jointly satisfies all constraints while minimizing latency. |

### 11.2 Detailed Comparison on 6-Query Canonical Batch

| Metric | MILP | Always-Gemini | Rule-Based |
|---|---|---|---|
| Total service latency | 6.84 s | 9.18 s | 6.66 s |
| Average latency per task | 1.14 s | 1.53 s | 1.11 s |
| Batch wall-clock time | 1.53 s | 1.53 s | 1.53 s |
| Backend usage: groq | 2 | 0 | 3 |
| Backend usage: gemini | 4 | 6 | 2 |
| Backend usage: local | 0 | 0 | 1 |
| Capability violations | **0** | 0 | **3** |
| RPM violations | **0** | 0 | 0 |

**Analysis:**
- **MILP vs. Always-Gemini:** 25.5% latency reduction, same zero-violation guarantee
- **MILP vs. Rule-Based:** Rule-Based is marginally faster (2.6%) but incurs **3 capability violations** (routes Medium tasks to Groq, which lacks the capability). MILP provides a mathematically guaranteed feasible solution — rule-based does not
- **The critical insight:** Simple heuristics can appear to "win" on latency metrics while silently violating correctness constraints. MILP's value is its joint guarantee of optimality *and* feasibility

---

## 12. Test Suite

### 12.1 Test Coverage Overview

| Test File | Tests | What It Verifies |
|---|---|---|
| [`test_complexity.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/tests/test_complexity.py) | 15 | All labeled examples from the complexity rubric (parametrized) |
| [`test_milp.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/tests/test_milp.py) | 4 | Core MILP behaviors (capability routing, RPM spillover, infeasibility) |
| [`test_integration.py`](file:///mnt/d/projects/Academic/B.Tech/OR/backend/tests/test_integration.py) | 4 | All 4 FastAPI endpoints with mocked LLM calls |
| **Total** | **23** | **100% pass rate** |

### 12.2 Critical MILP Tests

| Test | Description | Expected Result |
|---|---|---|
| `test_basic_capability_routing` | Low task → fast backend, High task → capable backend | `{1: "local", 2: "gemini"}` |
| `test_medium_complexity_lowest_latency` | Medium task (requires cap ≥ 3); local (cap 1) and groq (cap 2) ineligible | `{1: "gemini"}` |
| `test_rpm_capacity_constraint_binds` | 35 Low tasks; Groq RPM = 30 → 5 must spill to Gemini | `groq_count == 30, gemini_count == 5` |
| `test_infeasibility_check` | High task; no backend with cap ≥ 5 available | Raises `ValueError` with "infeasible" |

### 12.3 Running Tests

```bash
# From project root with virtual environment activated
python -m pytest backend/tests/ -v

# Expected output: 23 passed in ~2-3 seconds
```

---

## 13. Tech Stack

| Layer | Technology | Version | Role |
|---|---|---|---|
| **Optimization** | PuLP + CBC Solver | PuLP 3.x | MILP formulation and solving |
| **Backend API** | FastAPI | Latest | REST API endpoints |
| **ASGI Server** | Uvicorn | Latest | Serves the FastAPI app |
| **Data Validation** | Pydantic | v2 | Request/response schema validation |
| **LLM Client** | OpenAI Python SDK | Latest | OpenAI-compatible calls to all backends |
| **Local Inference** | Ollama | Latest | Hosts `llama3.2:1b` locally |
| **Frontend** | Next.js | 16 (App Router) | React framework with TypeScript |
| **Styling** | Tailwind CSS | v4 | Utility-first CSS |
| **Charts** | Recharts | Latest | Bar charts, scatter plots |
| **UI Primitives** | shadcn/ui | Latest | Accessible component library |
| **Testing** | pytest + httpx | Latest | Unit and integration tests |
| **Environment** | python-dotenv | Latest | `.env` secrets management |
| **Language (Backend)** | Python | 3.10+ | All backend logic |
| **Language (Frontend)** | TypeScript | Latest | Type-safe frontend |

---

## 14. Installation & Setup

### 14.1 Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.com/) (for local model hosting)
- Groq API key ([console.groq.com](https://console.groq.com))
- Gemini API key ([aistudio.google.com](https://aistudio.google.com))

### 14.2 Step-by-Step Setup

#### Step 1: Start Local Ollama Model

```bash
ollama serve                  # Start Ollama daemon
ollama pull llama3.2:1b       # Pull the 1B parameter model
```

#### Step 2: Python Backend Setup

```bash
# From project root
python -m venv .venv

# Activate (Linux/macOS/Git Bash)
source .venv/bin/activate

# Activate (Windows PowerShell)
.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r backend/requirements.txt

# Configure environment
cp env.example .env
# Edit .env and add GROQ_API_KEY and GEMINI_API_KEY
```

#### Step 3: Frontend Setup

```bash
cd frontend
npm install
```

### 14.3 Running the Project

**Terminal 1 — FastAPI Backend:**
```bash
python -m uvicorn backend.api.main:app --reload --port 8000
```
API live at `http://localhost:8000`  
Interactive OpenAPI docs at `http://localhost:8000/docs`

**Terminal 2 — Next.js Frontend:**
```bash
cd frontend
npm run dev
```
Open `http://localhost:3000`

### 14.4 Running Experiments

```bash
# Latency calibration (live API calls to all backends)
python backend/experiments/measure_latency.py

# Sensitivity analysis (multiplier sweep, no live calls)
python backend/experiments/sensitivity_analysis.py

# Pareto frontier analysis (alpha sweep, no live calls)
python backend/experiments/pareto_analysis.py

# Scalability benchmark (10–5000 tasks, no live calls)
python backend/experiments/scalability_test.py
```

---

## 15. Limitations & Future Work

### 15.1 TPM and RPD Not Modeled

The MILP enforces only RPM constraints. Two additional rate-limit dimensions recorded in config — **TPM (Tokens Per Minute)** and **RPD (Requests Per Day)** — are not modeled.

- **TPM** requires predicting output token length per task (adds model uncertainty)
- **RPD** operates on a 24-hour horizon different from single-batch optimization

**Future extension:** Add RPD budget constraint across batches in a sliding 24-hour window:
$$\sum_{\text{batches}} \sum_{i} x_{ij} \leq \text{RPD}_j$$

### 15.2 Capability Scores Are Unvalidated by Benchmark

Capability scores (1, 2, 3, 5) are normalized modeling assumptions, not empirically derived. The relative ordering is directionally correct, but specific gaps (especially Groq score 2 vs. Medium requirement score 3) have not been validated through head-to-head evaluation on labeled query sets (MMLU, HumanEval, etc.).

**Future extension:** Run each backend on a labeled benchmark, score outputs, use empirical scores to calibrate capability parameters.

### 15.3 Paid-Tier Cost-Sensitivity Extension

All backends are free-tier in the current deployment, so cost is not a meaningful differentiator. The `cost_per_1k_tokens` field is retained in config for a hypothetical paid-tier extension.

**Hypothetical paid-tier objective:**
$$\min \sum_{i \in I} \sum_{j \in J} \left( C_j + \lambda L_j \right) x_{ij}$$

where $\lambda$ controls the latency–cost tradeoff. This would produce a full latency-vs-cost Pareto frontier with real dollar savings (not just simulated).

### 15.4 Other Future Directions

| Direction | Description |
|---|---|
| **Dynamic latency monitoring** | Backend latency is currently a static calibrated value. Adaptive version: maintain rolling average and re-solve MILP periodically |
| **Learned complexity classifier** | Current rule-based classifier is simple and explainable. Replace with fine-tuned embedding model for higher recall |
| **Cerebras backend** | Add Cerebras (llama-3.3-70b, capability 3) as live backend — fills the Medium-complexity routing gap, potentially reducing total latency below current 6.84 s |
| **Per-task latency SLA** | Add constraint: `x_{ij} = 0` where `L_j > SLA_i` — ensures each task is served within its deadline |
| **Concurrent wall-clock metric** | Report `batch_wallclock_s` accurately (currently bounded by slowest task, not sum) |
| **TPM-aware routing** | Predict output token length per query → add TPM constraint to MILP |
| **Stochastic MILP** | Model latency as a random variable (mean + variance from profiling) → solve stochastic program for probabilistic SLA guarantees |

---

## 16. Conclusion

Aether Router demonstrates that **Mixed Integer Linear Programming is a practical and theoretically principled approach to LLM query routing**.

By formulating routing as a binary assignment problem, the system:
- **Jointly optimizes** total service latency
- **Hard-enforces** capability constraints (never routes a task to an incapable model)
- **Hard-enforces** rate-limit capacity constraints (never exceeds per-backend RPM limits)
- **Provides mathematical guarantees** that neither rule-based nor always-strongest-model policies can offer simultaneously

**On the 6-query canonical benchmark:**
- **25.5% lower total service latency** than the always-Gemini baseline (6.84 s vs. 9.18 s)
- **Zero capability violations** and **zero RPM violations**
- **100% test suite pass rate** across 23 automated unit and integration tests

The core OR contribution is: **globally optimal latency-feasible assignment can be computed in milliseconds for realistic batch sizes using open-source tools, at zero additional infrastructure cost**. The framework is extensible to paid-tier cost optimization, TPM/RPD constraints, empirically calibrated capability scores, and dynamic latency profiling — all of which are clearly defined future work.

---

## 17. Appendix — File Structure

```
Aether-Router/
│
├── backend/
│   ├── api/
│   │   └── main.py                  # FastAPI app: /route, /compare, /sensitivity, /pareto
│   ├── clients/
│   │   └── llm_client.py            # OpenAI-compatible multi-backend LLM client
│   ├── optimizer/
│   │   ├── milp.py                  # MILP formulation (PuLP / CBC)
│   │   ├── complexity.py            # Rule-based query complexity classifier
│   │   └── baselines.py             # Always-Gemini and Rule-Based baseline strategies
│   ├── experiments/
│   │   ├── measure_latency.py       # Live latency calibration (3 probes per backend)
│   │   ├── sensitivity_analysis.py  # Latency multiplier sweep (0.25×–3.0×)
│   │   ├── pareto_analysis.py       # Multi-objective alpha sweep, Pareto frontier
│   │   └── scalability_test.py      # MILP solver benchmark (10–5,000 tasks)
│   ├── tests/
│   │   ├── test_milp.py             # 4 deterministic MILP solver tests
│   │   ├── test_complexity.py       # 15 classifier tests (parametrized)
│   │   └── test_integration.py      # 4 end-to-end FastAPI endpoint tests
│   ├── config.py                    # Backend profiles (latency, capability, rate limits)
│   └── requirements.txt             # Python dependencies
│
├── frontend/
│   └── src/
│       └── app/
│           ├── page.tsx             # Main Dashboard: query input, MILP routing, results
│           ├── analytics/
│           │   └── page.tsx         # Analytics: strategy comparison bar charts
│           ├── sensitivity/
│           │   └── page.tsx         # Sensitivity Lab: latency multiplier heatmap
│           └── pareto/
│               └── page.tsx         # Pareto Lab: interactive frontier & alpha slider
│
├── Documentation/
│   ├── 01_backend_config.md         # Backend parameter documentation
│   ├── 02_complexity_rubric.md      # Complexity classification rules and examples
│   ├── 03_milp_formulation.md       # Full mathematical MILP specification
│   ├── 04_api_contract.md           # API schema and contract documentation
│   └── 05_test_cases.md             # Test case rationale and coverage
│
├── OR_Project_Report.md             # Full academic project report
├── DEVELOPER_DOCUMENTATION.md      # This file — comprehensive developer reference
├── README.md                        # Project overview and quick-start
├── env.example                      # Environment variable template
├── .env                             # API keys (git-ignored)
└── LICENSE                          # MIT License
```

---

*Documentation prepared: September 22, 2026. Experimental results from August 2026. Rate limits captured August 10, 2026 — verify before future experiments.*

*For questions about the mathematical formulation, see [Section 4](#4-mathematical-formulation-milp). For running experiments, see [Section 14](#14-installation--setup). For test execution, see [Section 12](#12-test-suite).*
