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
    
    # Capabilities checklist for 3-backend default fallbacks
    # local=1, groq=2, gemini=5
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
        assert "backend_usage" in metrics
        assert "capability_violations" in metrics
        assert "rpm_violations" in metrics
        
        assert metrics["capability_violations"] >= 0
        assert metrics["rpm_violations"] >= 0
        assert sum(metrics["backend_usage"].values()) == len(QUERIES)

    # Specific routing behavior checks
    # always_gemini must assign everything to gemini with 0 capability violations
    assert data["always_gemini"]["backend_usage"] == {"gemini": len(QUERIES)}
    assert data["always_gemini"]["capability_violations"] == 0

    # milp must have 0 capability violations and 0 rpm violations
    assert data["milp"]["capability_violations"] == 0
    assert data["milp"]["rpm_violations"] == 0
