import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
from backend.api.main import app

client = TestClient(app)

# The 6 queries from Section C of the test cases document
QUERIES = [
    "Translate this paragraph into French",
    "Summarize this research paper in 3 bullet points",
    "Solve this DSA problem: find the longest increasing subsequence",
    "Generate a SQL query to join two tables",
    "Write a professional email declining a meeting",
    "Explain recursion with an example"
]

@patch("backend.clients.llm_client.LLMClient.call")
def test_route_endpoint(mock_call):
    """
    Integration test verifying the POST /route endpoint.
    Mocks the live LLM Client calls to ensure offline and fast execution.
    """
    # Mock behavior of LLMClient.call
    def side_effect(backend, prompt):
        return {
            "text": f"Mocked response from {backend} for: {prompt[:15]}...",
            "latency_s": 0.45,
            "backend": backend,
            "model": "mock-model",
            "error": None
        }
    mock_call.side_effect = side_effect

    # Execute request
    response = client.post("/route", json={"queries": QUERIES})
    assert response.status_code == 200
    
    data = response.json()
    assert "results" in data
    assert "summary" in data
    
    results = data["results"]
    summary = data["summary"]
    
    assert len(results) == len(QUERIES)
    
    # Capabilities checklist for enabled backends (3-backend default for /route)
    # local=1, groq=2, gemini=5 (cerebras is disabled, not used in /route)
    backend_capabilities = {"local": 1, "groq": 2, "gemini": 5}
    complexity_capability_map = {"low": 1, "medium": 3, "high": 5}
    
    for item in results:
        # Check required fields
        assert "id" in item
        assert "query" in item
        assert "complexity" in item
        assert "assigned_backend" in item
        assert "response_text" in item
        assert "latency_s" in item
        
        # Verify capability constraint
        req_cap = complexity_capability_map[item["complexity"]]
        assigned_cap = backend_capabilities[item["assigned_backend"]]
        assert assigned_cap >= req_cap
        
        # Verify mock responses
        assert item["response_text"].startswith(f"Mocked response from {item['assigned_backend']}")
        assert item["latency_s"] == 0.45

    # Verify summary stats
    expected_total_latency = sum(item["latency_s"] for item in results)
    assert abs(summary["total_service_latency_s"] - expected_total_latency) < 1e-4
    assert abs(summary["average_latency_s"] - (expected_total_latency / len(QUERIES))) < 1e-4
    assert "batch_wallclock_s" in summary
    assert summary["batch_wallclock_s"] <= expected_total_latency
    assert sum(summary["backend_usage"].values()) == len(QUERIES)


def test_compare_endpoint():
    """
    Integration test verifying the POST /compare endpoint.
    This endpoint simulates latencies using config metrics and thus runs without external API calls.
    """
    response = client.post("/compare", json={"queries": QUERIES})
    assert response.status_code == 200
    
    data = response.json()
    assert "milp" in data
    assert "always_gemini" in data
    assert "rule_based" in data
    
    for method in ["milp", "always_gemini", "rule_based"]:
        metrics = data[method]
        assert "total_service_latency_s" in metrics
        assert "average_latency_s" in metrics
        assert "batch_wallclock_s" in metrics
        assert "backend_usage" in metrics
        assert "capability_violations" in metrics
        assert "rpm_violations" in metrics
        
        assert metrics["capability_violations"] >= 0
        assert metrics["rpm_violations"] >= 0
        assert metrics["batch_wallclock_s"] <= metrics["total_service_latency_s"]
        assert sum(metrics["backend_usage"].values()) == len(QUERIES)

    # Specific routing behavior checks
    # always_gemini must assign everything to gemini with 0 capability violations
    assert data["always_gemini"]["backend_usage"] == {"gemini": len(QUERIES)}
    assert data["always_gemini"]["capability_violations"] == 0

    # milp must have 0 capability violations and 0 rpm violations
    assert data["milp"]["capability_violations"] == 0
    assert data["milp"]["rpm_violations"] == 0


def test_sensitivity_endpoint():
    """
    Integration test verifying the POST /sensitivity endpoint.
    Verifies that sensitivity analysis across all 4 backends and 9 multipliers solves successfully.
    """
    response = client.post("/sensitivity", json={"queries": QUERIES})
    assert response.status_code == 200

    data = response.json()
    assert "results" in data
    assert "backends_analyzed" in data
    assert "multipliers_used" in data
    assert "task_count" in data

    assert data["task_count"] == len(QUERIES)
    assert set(data["backends_analyzed"]) == {"local", "groq", "gemini", "cerebras"}
    assert len(data["multipliers_used"]) == 9
    assert len(data["results"]) == 4 * 9

    # Verify fields of each result item
    for item in data["results"]:
        assert "varied_backend" in item
        assert "multiplier" in item
        assert "varied_latency_s" in item
        assert "assignments" in item
        assert "total_latency_s" in item
        assert "is_baseline" in item
        assert "breakeven_note" in item
        assert item["total_latency_s"] > 0
        assert sum(item["assignments"].values()) == len(QUERIES)


def test_pareto_endpoint():
    """
    Integration test verifying the POST /pareto endpoint.
    Verifies multi-objective Pareto Frontier calculation and tradeoff statistics.
    """
    response = client.post("/pareto", json={"queries": QUERIES, "steps": 11})
    assert response.status_code == 200

    data = response.json()
    assert "points" in data
    assert "pareto_optimal_points" in data
    assert "max_cost_savings_pct" in data
    assert "max_latency_savings_pct" in data
    assert "task_count" in data
    assert "backends_included" in data

    assert data["task_count"] == len(QUERIES)
    assert len(data["points"]) > 0
    assert len(data["pareto_optimal_points"]) > 0
    assert data["max_latency_savings_pct"] >= 0.0
    assert data["max_cost_savings_pct"] >= 0.0

    for pt in data["points"]:
        assert "alpha" in pt
        assert "latency_weight" in pt
        assert "cost_weight" in pt
        assert "total_latency_s" in pt
        assert "total_cost_usd" in pt
        assert "assignments" in pt
        assert "is_pareto_optimal" in pt
        assert sum(pt["assignments"].values()) == len(QUERIES)


