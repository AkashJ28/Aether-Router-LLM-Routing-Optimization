# Aether Router: MILP LLM Routing Optimization

[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue?logo=python&logoColor=white)](https://www.python.org/downloads/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PuLP](https://img.shields.io/badge/Solver-PuLP%20CBC-orange)](https://coin-or.github.io/pulp/)

**Aether Router** is a mathematical optimization framework that formulates Large Language Model (LLM) query routing as a **Mixed Integer Linear Programming (MILP)** assignment problem.

Instead of routing queries using brittle heuristic if-else rules or incurring the overhead of expensive "always-run-strongest" strategies, Aether Router dynamically evaluates the complexity of a batch of user queries and distributes them across a heterogeneous set of local and cloud-based LLM providers. The framework minimizes total service latency while strictly satisfying rate-limit capacity (Requests-Per-Minute) and capability constraints.

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

In a multi-model environment, developers face trade-offs between speed, cost, rate limits, and reasoning capability. Aether Router models this choice as a resource allocation problem, solved optimally per batch using the **PuLP** optimization library with the **CBC solver**.

### Decision Variable

$$x_{ij} \in \{0, 1\} \quad \text{representing if task } i \text{ is assigned to backend } j$$

### Objective

Minimize total service latency:

$$\min \sum_{i \in I} \sum_{j \in J} L_j x_{ij}$$

Where $L_j$ is the calibrated wall-clock response latency of backend $j$.

### Constraints

1. **Uniqueness** — Each task is assigned to exactly one backend:
   $$\sum_{j \in J} x_{ij} = 1 \quad \forall i \in I$$

2. **Capability Satisfaction** — A backend $j$ can only receive task $i$ if its capability score meets or exceeds the task's required complexity:
   $$x_{ij} = 0 \quad \text{whenever } \text{Cap}_j < R_i$$
   *(Complexity is categorized as Low ($R_i=1$), Medium ($R_i=3$), or High ($R_i=5$))*

3. **Rate Limit Enforcement** — The number of queries dispatched to a backend within a batch cannot exceed its Requests-Per-Minute (RPM) capacity:
   $$\sum_{i \in I} x_{ij} \le \text{RPM}_j \quad \forall j \in J \text{ with finite RPM}$$

---

## 2. System Architecture

```text
                        Incoming Query Batch
                                │
                                ▼
                 Rule-Based Complexity Classifier
                  (keyword scan + length fallback)
                                │
                                ▼
                   MILP Optimization Engine (PuLP)
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
      Local Ollama           Groq API           Gemini API
     (llama3.2:1b)     (llama-3.1-8b-instant) (gemini-2.5-flash)
            │                   │                   │
            └───────────────────┼───────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            Dashboard Page            Analytics Page
          (Batch Routing Panel)    (Baseline Comparison)
```

### Backends Profile (Calibrated Free-Tier Config)

| Backend | Model | Capability | Latency | RPM Limit | Hosting |
|---|---|---|---|---|---|
| **Local Ollama** | `llama3.2:1b` | 1 (Low) | 1.98 s | Unlimited | Self-hosted (GPU) |
| **Groq API** | `llama-3.1-8b-instant` | 2 (Low–Med) | 0.36 s | 30 | Cloud |
| **Gemini API** | `gemini-2.5-flash` | 5 (All) | 1.53 s | Unlimited | Cloud |

---

## 3. Key Features

### MILP-Optimized Batch Routing
- Solves the assignment problem per batch using PuLP's CBC solver
- Minimizes total service latency while respecting capability and RPM constraints
- Handles Groq RPM overflow by spilling excess queries to the next cheapest capable backend

### Three-Way Routing Strategy Comparison
- **MILP Optimizer** — Optimal constrained assignment (zero violations guaranteed)
- **Always Gemini** — Sends everything to the strongest model (latency baseline)
- **Rule-Based** — Fixed heuristic routing (Low→Local, Medium→Groq, High→Gemini) that violates capability constraints

### Real-Time Developer Dashboard
- Terminal-style execution logs with color-coded routing decisions
- Live backend telemetry cards showing model status, calibrated latency, and Groq RPM usage bar
- Query result viewer with complexity/backend badges and per-task latency
- Three preset query batches: **Balanced**, **Groq Overflow (35 Qs)**, and **High Reasoning**

### Analytics & Benchmarking Page
- Side-by-side bar chart visualization (Recharts) comparing total service latency across all three strategies
- KPI metric cards: Rate Limits Avoided, Capability Violations Avoided, Peak Routing Efficiency (% speedup vs Always-Gemini)
- Re-evaluate baselines on custom query sets in real time

### Client-Side Fallback Mode
- Both the Dashboard and Analytics pages gracefully degrade when the FastAPI backend is unreachable
- A full client-side MILP simulator mirrors the backend's routing logic, allowing the frontend to demo independently with a visible warning banner

### Concurrent LLM Execution
- Backend dispatches optimized assignments to all three providers in parallel using `ThreadPoolExecutor`
- Measures wall-clock latency per query for real performance telemetry

### Complexity Classification
- Two-stage rule-based classifier: keyword scanning (high/medium/low keyword sets) with a word-count length fallback
- 15 validated test cases covering edge cases like "Explain recursion with an example" (medium, not high)

### Latency Calibration Experiment
- Standalone script to measure live average latency across all backends with 3 probe queries each
- Outputs a formatted table and a suggestion to update `config.py` with fresh measurements

---

## 4. Project Structure

```text
Aether-Router/
├── .env                          # API keys (git-ignored)
├── .gitignore
├── env.example                   # Template for .env
├── README.md
├── OR_Project_Report.md          # Academic project report
│
├── backend/
│   ├── config.py                 # Backend profiles: latency, capability, RPM, models
│   ├── conftest.py               # Pytest sys.path configuration
│   ├── requirements.txt          # Python dependencies
│   │
│   ├── api/
│   │   └── main.py               # FastAPI app: /route and /compare endpoints
│   │
│   ├── clients/
│   │   └── llm_client.py         # Unified OpenAI-compatible client for all 3 backends
│   │
│   ├── optimizer/
│   │   ├── milp.py               # PuLP MILP solver implementation
│   │   ├── complexity.py         # Query complexity classifier (keyword + length)
│   │   └── baselines.py          # Baseline routing strategies for comparison
│   │
│   ├── experiments/
│   │   └── measure_latency.py    # Live latency calibration script
│   │
│   └── tests/
│       ├── test_complexity.py    # 15 parametrized complexity classification tests
│       ├── test_milp.py          # MILP solver unit tests (capability, RPM, infeasibility)
│       └── test_integration.py   # FastAPI route + compare endpoint integration tests
│
├── frontend/
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── app/
│       │   ├── layout.tsx        # Root layout with sidebar navigation
│       │   ├── page.tsx          # Dashboard: batch routing panel + terminal logs
│       │   ├── globals.css
│       │   └── analytics/
│       │       └── page.tsx      # Analytics: strategy comparison charts
│       ├── components/
│       │   └── ui/               # shadcn/ui component primitives
│       └── lib/
│           └── utils.ts          # Tailwind merge utilities
│
└── Documentation/                # Internal design docs (git-ignored)
```

---

## 5. Tech Stack

| Layer | Technologies |
|---|---|
| **Optimization** | PuLP (CBC Solver), MILP formulation |
| **Backend API** | Python 3.10+, FastAPI, Uvicorn, Pydantic |
| **LLM Clients** | OpenAI Python SDK (compatible with Ollama, Groq, Gemini endpoints) |
| **Frontend** | Next.js 16 (App Router, TypeScript), Tailwind CSS v4, Recharts, shadcn/ui, Lucide Icons |
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
   Open the `.env` file and insert your API keys for **Groq** and **Gemini**.

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

Run both the backend API and the Next.js frontend simultaneously for the full experience.

### 1. Boot the FastAPI Backend Server

From the project root (with your virtual environment activated):

```bash
python -m uvicorn backend.api.main:app --reload --port 8000
```

The backend API is now running at `http://localhost:8000`. Interactive OpenAPI docs are available at `http://localhost:8000/docs`.

### 2. Boot the Next.js Frontend Dashboard

From the `frontend/` directory:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

> **Note:** The frontend works independently even if the backend is offline — it will automatically switch to client-side simulation mode with a visible warning banner.

---

## 8. API Reference

### `POST /route`

Classifies queries by complexity, solves the MILP assignment, dispatches live LLM calls in parallel, and returns results with measured latencies.

**Request:**
```json
{
  "queries": [
    "Translate this paragraph into French",
    "Solve this DSA problem: find the longest increasing subsequence"
  ]
}
```

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
    "backend_usage": { "groq": 1, "gemini": 1 }
  }
}
```

---

### `POST /compare`

Runs all three routing strategies (MILP, Always-Gemini, Rule-Based) on the same query batch and returns simulated metrics for benchmarking. **Does not make live LLM calls** — uses calibrated latencies from `config.py`.

**Request:**
```json
{
  "queries": ["Translate this paragraph into French", "..."]
}
```

**Response:**
```json
{
  "milp": {
    "total_service_latency_s": 5.49,
    "average_latency_s": 0.915,
    "backend_usage": { "groq": 2, "gemini": 4 },
    "capability_violations": 0,
    "rpm_violations": 0
  },
  "always_gemini": { "..." },
  "rule_based": { "..." }
}
```

---

## 9. Testing & Validation

Aether Router has a comprehensive suite of unit and integration tests verifying the complexity classifier, the MILP solver logic (including Groq RPM overflow/spillover and infeasibility detection), and both FastAPI endpoints.

### Run Automated Tests

From the project root:

```bash
python -m pytest backend/tests/ -v
```

### Test Coverage

| Test File | What It Verifies |
|---|---|
| `test_complexity.py` | 15 parametrized cases against the complexity rubric |
| `test_milp.py` | Capability routing, medium→Gemini only, RPM spillover (35 tasks), infeasibility |
| `test_integration.py` | `/route` endpoint (mocked LLM calls), `/compare` endpoint (simulated metrics), constraint validation |

### Run Latency Calibration

To recalibrate backend latencies with fresh live measurements:

```bash
python backend/experiments/measure_latency.py
```

This sends 3 probe queries to each backend and outputs a formatted latency table. Update the `latency_s` fields in `backend/config.py` with the measured averages.

---

## 10. Security Note

> [!IMPORTANT]
> **Do not hardcode your provider API keys (Groq/Gemini) in source files or commit them to version control.** Always place keys inside the root `.env` file. The `.gitignore` is configured to block `.env` from being staged or pushed.

---

## 11. License

This project is licensed under the [MIT License](LICENSE).
