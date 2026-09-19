# Aether Router: MILP LLM Routing Optimization

[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue?logo=python&logoColor=white)](https://www.python.org/downloads/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PuLP](https://img.shields.io/badge/Solver-PuLP%20CBC-orange)](https://coin-or.github.io/pulp/)

**Aether Router** is a mathematical optimization framework that formulates Large Language Model (LLM) query routing as a **Mixed Integer Linear Programming (MILP)** assignment problem.

Instead of routing queries using brittle heuristic if-else rules or incurring the overhead of expensive "always-run-strongest" strategies, Aether Router dynamically evaluates the complexity of a batch of user queries and distributes them across a heterogeneous set of local and cloud-based LLM providers. The framework minimizes a weighted combination of **service latency** and **API token cost** while strictly satisfying rate-limit capacity (Requests-Per-Minute) and capability constraints.

---

## Table of Contents

- [Mathematical Formulation](#1-mathematical-formulation)
- [System Architecture](#2-system-architecture)
- [Key Features](#3-key-features)
- [Project Structure](#4-project-structure)
- [Tech Stack](#5-tech-stack)
- [Installation & Setup](#6-installation--setup)
- [Running the Project](#7-running-the-project)
- [API Reference](#8-api-reference)
- [Testing & Validation](#9-testing--validation)
- [Security Note](#10-security-note)
- [License](#11-license)

---

## 1. Mathematical Formulation

In a multi-model environment, developers face trade-offs between speed, cost, rate limits, and reasoning capability. Aether Router models this as a resource allocation problem solved optimally per batch using the **PuLP** optimization library with the **CBC solver**.

### Decision Variable

$$x_{ij} \in \{0, 1\} \quad \text{representing if task } i \text{ is assigned to backend } j$$

### Multi-Objective Scalarized Objective

To simultaneously minimize both **latency** and **token cost**, the solver applies min-max normalization and uses a scalarized objective parameterized by $\alpha \in [0.0, 1.0]$:

$$\hat{L}_j = \frac{L_j - L_{\min}}{L_{\max} - L_{\min} + \varepsilon}, \quad \hat{C}_j = \frac{C_j - C_{\min}}{C_{\max} - C_{\min} + \varepsilon}$$

$$\min \sum_{i \in I} \sum_{j \in J} \left( \alpha \cdot \hat{L}_j + (1 - \alpha) \cdot \hat{C}_j \right) x_{ij}$$

| $\alpha$ value | Optimization mode |
|---|---|
| `alpha = 1.0` | Pure Latency Minimization (default, backward-compatible) |
| `alpha = 0.0` | Pure Token Cost Minimization |
| `0 < alpha < 1` | Weighted Pareto Tradeoff — latency vs. cost |

### Constraints

1. **Uniqueness** — Each task is assigned to exactly one backend:
   $$\sum_{j \in J} x_{ij} = 1 \quad \forall i \in I$$

2. **Capability Satisfaction** — A backend $j$ can only receive task $i$ if its capability score meets or exceeds the task's required complexity:
   $$x_{ij} = 0 \quad \text{whenever } \text{Cap}_j < R_i$$
   *(Complexity: Low $R_i=1$, Medium $R_i=3$, High $R_i=5$)*

3. **Rate Limit Enforcement** — Queries dispatched per backend cannot exceed its Requests-Per-Minute (RPM) capacity:
   $$\sum_{i \in I} x_{ij} \le \text{RPM}_j \quad \forall j \in J \text{ with finite RPM}$$

---

## 2. System Architecture

```text
                        Incoming Query Batch
                                |
                                v
                 Rule-Based Complexity Classifier
                  (keyword scan + length fallback)
                                |
                                v
            Multi-Objective MILP Optimization Engine (PuLP)
              Objective: alpha*Norm_Latency + (1-alpha)*Norm_Cost
                                |
            +-------------------+-------------------+
            v                   v                   v
      Local Ollama           Groq API           Gemini API
     (llama3.2:1b)     (llama-3.1-8b-instant) (gemini-2.5-flash)
            |                   |                   |
            +-------------------+-------------------+
                                |
          +----------+----------+----------+----------+
          v          v          v          v          v
      Dashboard  Analytics  Sensitivity  Pareto     /api
       (Routing)  (Compare)   Lab         Lab
```

### Backends Profile (Calibrated Free-Tier Config)

| Backend | Model | Capability | Latency | RPM Limit | Cost/1k tokens |
|---|---|---|---|---|---|
| **Local Ollama** | `llama3.2:1b` | 1 (Low) | 1.98 s | Unlimited | $0.0000 |
| **Groq API** | `llama-3.1-8b-instant` | 2 (Low-Med) | 0.36 s | 30 | $0.0001 |
| **Cerebras** *(simulated)* | `llama-3.3-70b` | 3 (Med) | 0.25 s | 30 | $0.0002 |
| **Gemini API** | `gemini-2.5-flash` | 5 (All) | 1.53 s | Unlimited | $0.0015 |

> Cerebras is modeled for simulation and OR experiments but excluded from live `/route` execution (`enabled: false`).

---

## 3. Key Features

### Multi-Objective MILP Routing
- Scalarized objective balances **latency** and **token cost** via a single `alpha` weight parameter
- Min-max normalization eliminates unit-scale bias between seconds and dollars
- Backward-compatible: `alpha = 1.0` (default) reproduces the original latency-only solver behavior

### Pareto Frontier Lab
- Sweeps `alpha` across `[0.0, 0.1, ..., 1.0]` — solves **11 distinct MILP problems** per batch
- Computes the non-dominated Pareto-optimal frontier (neither objective improvable without degrading the other)
- Interactive frontend with **real-time alpha weight slider**, Cost vs. Latency scatter plot, and clickable operating point table

### Sensitivity Analysis Lab
- Varies each backend's latency from **0.25x to 3.0x** of its calibrated baseline
- Re-solves the MILP for each variation and flags assignment breakeven boundaries
- Reveals how robust optimal assignments are to measurement error or unexpected latency spikes

### Scalability Experiment
- Benchmarks solver wall-clock time on batches from **10 to 5,000 tasks**
- Demonstrates that the PuLP/CBC MILP approach scales practically for realistic workloads

### Three-Way Routing Strategy Comparison
- **MILP Optimizer** — Optimal constrained assignment (zero violations guaranteed)
- **Always Gemini** — Sends everything to the strongest model (latency baseline)
- **Rule-Based** — Fixed heuristic routing that violates capability constraints

### Real-Time Developer Dashboard
- Terminal-style execution logs with color-coded routing decisions
- Live backend telemetry cards: model status, calibrated latency, Groq RPM usage bar
- Query result viewer with complexity/backend badges and per-task latency
- Three preset query batches: **Balanced**, **Groq Overflow (35 Qs)**, and **High Reasoning**

### Analytics & Benchmarking Page
- Side-by-side bar chart comparing total service latency across all three routing strategies
- KPI cards: Rate Limits Avoided, Capability Violations Avoided, Peak Routing Efficiency

### Client-Side Fallback Mode
- All four pages (Dashboard, Analytics, Sensitivity Lab, Pareto Lab) gracefully degrade when the FastAPI backend is unreachable
- A client-side simulator mirrors the backend routing logic with a visible warning banner

### Concurrent LLM Execution
- Backend dispatches optimized assignments to all providers in parallel using `ThreadPoolExecutor`
- Measures wall-clock latency per query for real performance telemetry

---

## 4. Project Structure

```text
Aether-Router/
+-- .env                          # API keys (git-ignored)
+-- .gitignore
+-- env.example                   # Template for .env
+-- README.md
+-- OR_Project_Report.md          # Academic project report
|
+-- backend/
|   +-- config.py                 # Backend profiles: latency, capability, RPM, cost, models
|   +-- conftest.py               # Pytest sys.path configuration
|   +-- requirements.txt          # Python dependencies
|   |
|   +-- api/
|   |   +-- main.py               # FastAPI: /route, /compare, /sensitivity, /pareto
|   |
|   +-- clients/
|   |   +-- llm_client.py         # Unified OpenAI-compatible client for all backends
|   |
|   +-- optimizer/
|   |   +-- milp.py               # Multi-objective PuLP MILP solver (alpha-parameterized)
|   |   +-- complexity.py         # Query complexity classifier (keyword + length)
|   |   +-- baselines.py          # Baseline routing strategies for comparison
|   |
|   +-- experiments/
|   |   +-- measure_latency.py    # Live latency calibration script
|   |   +-- sensitivity_analysis.py  # Latency sensitivity sweep experiment
|   |   +-- pareto_analysis.py    # Multi-objective Pareto frontier sweep
|   |   +-- scalability_test.py   # Solver scalability benchmark (10-5000 tasks)
|   |
|   +-- tests/
|       +-- test_complexity.py    # 15 parametrized complexity classification tests
|       +-- test_milp.py          # MILP solver unit tests (capability, RPM, multi-obj)
|       +-- test_integration.py   # /route, /compare, /sensitivity, /pareto endpoints
|
+-- frontend/
|   +-- package.json
|   +-- next.config.ts
|   +-- tsconfig.json
|   +-- src/
|       +-- app/
|       |   +-- layout.tsx        # Root layout with sidebar navigation
|       |   +-- globals.css
|       |   +-- page.tsx          # Dashboard: batch routing panel + terminal logs
|       |   +-- analytics/
|       |   |   +-- page.tsx      # Analytics: strategy comparison bar charts
|       |   +-- sensitivity/
|       |   |   +-- page.tsx      # Sensitivity Lab: latency multiplier heatmap
|       |   +-- pareto/
|       |       +-- page.tsx      # Pareto Lab: interactive frontier & alpha slider
|       +-- components/
|       |   +-- ui/               # shadcn/ui component primitives
|       +-- lib/
|           +-- utils.ts
|
+-- Documentation/                # Internal design docs (git-ignored)
```

---

## 5. Tech Stack

| Layer | Technologies |
|---|---|
| **Optimization** | PuLP (CBC Solver), MILP formulation, multi-objective scalarization |
| **Backend API** | Python 3.10+, FastAPI, Uvicorn, Pydantic |
| **LLM Clients** | OpenAI Python SDK (compatible with Ollama, Groq, Gemini endpoints) |
| **Frontend** | Next.js 16 (App Router, TypeScript), Tailwind CSS v4, Recharts, shadcn/ui |
| **Testing** | pytest, FastAPI TestClient, httpx, unittest.mock |
| **Environment** | python-dotenv, `.env` for secrets management |

---

## 6. Installation & Setup

### Prerequisites

- [Python 3.10+](https://www.python.org/downloads/)
- [Node.js 18+](https://nodejs.org/)
- [Ollama](https://ollama.com/) (for local model hosting)
- A **Groq API key** ([console.groq.com](https://console.groq.com))
- A **Gemini API key** ([aistudio.google.com](https://aistudio.google.com))

---

### Step A: Start the Local Ollama Model

1. Open a terminal and start the Ollama service:
   ```bash
   ollama serve
   ```
2. Pull the lightweight `llama3.2:1b` model:
   ```bash
   ollama pull llama3.2:1b
   ```

---

### Step B: Set Up the Backend

1. Navigate to the project root and create a Python virtual environment:
   ```bash
   python -m venv .venv
   ```
2. Activate the virtual environment:
   - **PowerShell**:
     ```powershell
     .venv\Scripts\Activate.ps1
     ```
   - **Git Bash / macOS / Linux**:
     ```bash
     source .venv/bin/activate
     ```
   - **Command Prompt**:
     ```cmd
     .venv\Scripts\activate.bat
     ```
3. Install dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
4. Copy the environment variables template and add your API keys:
   ```bash
   cp env.example .env
   ```
   Open `.env` and insert your **Groq** and **Gemini** API keys.

---

### Step C: Set Up the Frontend

1. Navigate to the `frontend/` directory:
   ```bash
   cd frontend
   ```
2. Install npm packages:
   ```bash
   npm install
   ```

---

## 7. Running the Project

Run both servers simultaneously for the full experience.

### 1. Boot the FastAPI Backend

From the project root (with your virtual environment activated):

```bash
python -m uvicorn backend.api.main:app --reload --port 8000
```

The API is live at `http://localhost:8000`. Interactive OpenAPI docs: `http://localhost:8000/docs`.

### 2. Boot the Next.js Frontend

From the `frontend/` directory:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

> **Note:** All four pages degrade gracefully when the backend is offline — the frontend switches to client-side simulation mode with a visible warning banner.

---

## 8. API Reference

### `POST /route`

Classifies queries by complexity, solves the multi-objective MILP assignment, dispatches live LLM calls in parallel, and returns results with measured latencies.

**Request:**
```json
{
  "queries": [
    "Translate this paragraph into French",
    "Solve this DSA problem: find the longest increasing subsequence"
  ],
  "alpha": 1.0
}
```

- `alpha` (optional, default `1.0`): Latency weight. `1.0` = pure speed, `0.0` = pure cost.

**Response:**
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
    "backend_usage": { "groq": 1, "gemini": 1 }
  }
}
```

---

### `POST /compare`

Runs MILP, Always-Gemini, and Rule-Based strategies on the same batch and returns simulated metrics. **Does not make live LLM calls.**

**Request:**
```json
{
  "queries": ["Translate this paragraph into French", "..."],
  "alpha": 1.0
}
```

**Response:**
```json
{
  "milp": {
    "total_service_latency_s": 5.49,
    "average_latency_s": 0.915,
    "batch_wallclock_s": 1.53,
    "backend_usage": { "groq": 2, "gemini": 4 },
    "capability_violations": 0,
    "rpm_violations": 0
  },
  "always_gemini": { "..." },
  "rule_based": { "..." }
}
```

---

### `POST /sensitivity`

Sweeps each backend's latency from 0.25x to 3.0x of its calibrated baseline, re-solving the MILP at each step to reveal assignment breakeven points.

**Request:**
```json
{
  "queries": ["..."],
  "multipliers": [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]
}
```

**Response:**
```json
{
  "results": [
    {
      "varied_backend": "groq",
      "multiplier": 2.0,
      "varied_latency_s": 0.72,
      "assignments": { "local": 2, "groq": 1, "gemini": 3 },
      "total_latency_s": 8.17,
      "is_baseline": false,
      "breakeven_note": "groq loses tasks to local at 2.0x"
    }
  ],
  "backends_analyzed": ["local", "groq", "gemini", "cerebras"],
  "multipliers_used": [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0],
  "task_count": 6
}
```

---

### `POST /pareto`

Sweeps `alpha` across `steps` MILP solves, returns the non-dominated Pareto frontier of (latency, cost) operating points.

**Request:**
```json
{
  "queries": ["..."],
  "steps": 11
}
```

**Response:**
```json
{
  "points": [
    {
      "alpha": 0.0,
      "latency_weight": 0.0,
      "cost_weight": 1.0,
      "total_latency_s": 6.24,
      "total_cost_usd": 0.0021,
      "assignments": { "local": 2, "groq": 0, "gemini": 1, "cerebras": 3 },
      "is_pareto_optimal": true
    }
  ],
  "pareto_optimal_points": ["..."],
  "max_cost_savings_pct": 16.0,
  "max_latency_savings_pct": 55.45,
  "task_count": 6,
  "backends_included": ["local", "groq", "gemini", "cerebras"]
}
```

---

## 9. Testing & Validation

Aether Router includes a comprehensive test suite covering the complexity classifier, MILP solver logic, all four API endpoints, and multi-objective behavior.

### Run Automated Tests

From the project root:

```bash
python -m pytest backend/tests/ -v
```

**23 tests — all pass.**

### Test Coverage

| Test File | What It Verifies |
|---|---|
| `test_complexity.py` | 15 parametrized cases against the complexity rubric |
| `test_milp.py` | Capability routing, medium->Gemini only, RPM spillover (35 tasks), infeasibility, multi-objective alpha |
| `test_integration.py` | `/route` (mocked LLM), `/compare`, `/sensitivity`, `/pareto` endpoints |

### Standalone Experiment Scripts

| Script | Purpose |
|---|---|
| `backend/experiments/measure_latency.py` | Live latency calibration — 3 probe queries per backend |
| `backend/experiments/sensitivity_analysis.py` | Latency multiplier sweep (0.25x-3.0x) with breakeven analysis |
| `backend/experiments/pareto_analysis.py` | Multi-objective alpha sweep, Pareto frontier extraction |
| `backend/experiments/scalability_test.py` | MILP solver wall-clock benchmark on 10-5,000-task batches |

Run any experiment from the project root:

```bash
python backend/experiments/pareto_analysis.py
python backend/experiments/sensitivity_analysis.py
python backend/experiments/scalability_test.py
```

---

## 10. Security Note

> **Do not hardcode your provider API keys (Groq/Gemini) in source files or commit them to version control.** Always place keys inside the root `.env` file. The `.gitignore` is configured to block `.env` from being staged or pushed.

---

## 11. License

This project is licensed under the [MIT License](LICENSE).
