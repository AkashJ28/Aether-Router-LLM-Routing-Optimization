import pytest
from backend.optimizer.milp import solve

def test_basic_capability_routing():
    # Test 1: Basic capability routing with 3 backends
    backends = {
        "local": {"latency_s": 0.4, "capability": 1, "rpm_limit": None},
        "groq": {"latency_s": 0.5, "capability": 2, "rpm_limit": 30},
        "gemini": {"latency_s": 1.0, "capability": 5, "rpm_limit": None},
    }
    
    tasks = [
        {"id": 1, "complexity": "low"},
        {"id": 2, "complexity": "high"},
    ]
    
    result = solve(tasks, backends)
    assert result == {1: "local", 2: "gemini"}

def test_medium_complexity_lowest_latency():
    # Test 2: Medium complexity (req capability 3) must route to gemini (capability 5)
    # since local (1) and groq (2) do not satisfy the capability constraint.
    backends = {
        "local": {"latency_s": 0.3, "capability": 1, "rpm_limit": None},
        "groq": {"latency_s": 0.4, "capability": 2, "rpm_limit": 30},
        "gemini": {"latency_s": 1.0, "capability": 5, "rpm_limit": None},
    }
    
    tasks = [{"id": 1, "complexity": "medium"}]
    
    result = solve(tasks, backends)
    assert result == {1: "gemini"}

def test_rpm_capacity_constraint_binds():
    # Test 3: RPM capacity constraint binds and causes spillover to gemini
    backends = {
        "local": {"latency_s": 2.0, "capability": 1, "rpm_limit": None},
        "groq": {"latency_s": 0.5, "capability": 2, "rpm_limit": 30},
        "gemini": {"latency_s": 1.5, "capability": 5, "rpm_limit": None},
    }
    
    tasks = [{"id": i, "complexity": "low"} for i in range(1, 36)]
    
    result = solve(tasks, backends)
    
    # Verify that exactly 30 tasks are assigned to groq (its RPM limit)
    groq_count = sum(1 for b in result.values() if b == "groq")
    assert groq_count == 30
    assert len(result) == 35
    
    # The remaining 5 tasks should spill over to gemini (the next fastest eligible backend)
    gemini_count = sum(1 for b in result.values() if b == "gemini")
    assert gemini_count == 5

def test_infeasibility_check():
    # Test 4: Infeasibility check when no capable backend exists for a high-complexity task (requires 5)
    backends = {
        "local": {"latency_s": 0.8, "capability": 1, "rpm_limit": None},
        "groq": {"latency_s": 0.5, "capability": 2, "rpm_limit": 30},
        # gemini is removed, so no backend has capability >= 5
    }
    
    tasks = [{"id": 1, "complexity": "high"}]
    
    with pytest.raises(ValueError) as excinfo:
        solve(tasks, backends)
    assert "infeasible" in str(excinfo.value).lower()
