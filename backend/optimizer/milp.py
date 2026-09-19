import pulp

def solve(tasks: list[dict], backends: dict, alpha: float = 1.0) -> dict[int, str]:
    """
    Solves the LLM routing problem using Mixed Integer Linear Programming (MILP).

    tasks:    [{"id": 1, "complexity": "low"},
               {"id": 2, "complexity": "high"}, ...]
    backends: config.BACKENDS dict containing latency_s, capability, rpm_limit, cost_per_1k_tokens.
    alpha:    Multi-objective tradeoff weight in [0.0, 1.0].
              alpha = 1.0 -> Pure Latency Minimization (default)
              alpha = 0.0 -> Pure Cost Minimization
              0.0 < alpha < 1.0 -> Weighted Normalized Latency and Cost Minimization
    Returns:  {1: "local", 2: "gemini", ...}
    Raises a ValueError if the problem is infeasible.
    """
    if not tasks:
        return {}

    # Clamp alpha to [0.0, 1.0]
    alpha = max(0.0, min(1.0, float(alpha)))

    # Define capability mapping matching the complexity rubric
    complexity_map = {
        "low": 1,
        "medium": 3,
        "high": 5
    }

    # Create the PuLP optimization problem
    prob = pulp.LpProblem("LLM_Routing_Optimization", pulp.LpMinimize)

    # Decision variables x[i, j] representing if task i is assigned to backend j
    x = {}
    for task in tasks:
        t_id = task["id"]
        for b_name in backends.keys():
            x[t_id, b_name] = pulp.LpVariable(f"x_{t_id}_{b_name}", cat=pulp.LpBinary)

    # Calculate min/max normalization parameters for Multi-Objective optimization
    latencies = [b.get("latency_s", 1.0) for b in backends.values()]
    costs = [b.get("cost_per_1k_tokens", 0.0) for b in backends.values()]

    min_lat, max_lat = min(latencies), max(latencies)
    min_cost, max_cost = min(costs), max(costs)

    lat_range = (max_lat - min_lat) if (max_lat - min_lat) > 1e-6 else 1.0
    cost_range = (max_cost - min_cost) if (max_cost - min_cost) > 1e-6 else 1.0

    # Objective Function Construction
    objective_terms = []
    for task in tasks:
        t_id = task["id"]
        for b_name, b_info in backends.items():
            latency = b_info.get("latency_s")
            cost = b_info.get("cost_per_1k_tokens", 0.0)
            if latency is None:
                raise ValueError(
                    f"Backend '{b_name}' has no latency configured (latency_s is None)."
                )

            if abs(alpha - 1.0) < 1e-9:
                # Pure latency minimization
                coeff = latency
            elif abs(alpha - 0.0) < 1e-9:
                # Pure cost minimization
                coeff = cost
            else:
                # Normalized multi-objective tradeoff score
                norm_lat = (latency - min_lat) / lat_range
                norm_cost = (cost - min_cost) / cost_range
                coeff = alpha * norm_lat + (1.0 - alpha) * norm_cost

            objective_terms.append(coeff * x[t_id, b_name])

    prob += pulp.lpSum(objective_terms)

    # Constraint A: Each task is assigned to exactly one backend
    for task in tasks:
        t_id = task["id"]
        prob += pulp.lpSum(x[t_id, b_name] for b_name in backends.keys()) == 1

    # Constraint B: Capability constraint (Backend capability >= task required capability)
    for task in tasks:
        t_id = task["id"]
        req_cap = complexity_map.get(task["complexity"].lower())
        if req_cap is None:
            raise ValueError(f"Unknown complexity level: '{task['complexity']}' for task ID {t_id}")
            
        for b_name, b_info in backends.items():
            cap = b_info.get("capability", 0)
            if cap < req_cap:
                # Force assignment variable to 0 if the backend is not capable
                prob += x[t_id, b_name] == 0

    # Constraint C: RPM Capacity constraint per backend (for finite rpm_limits)
    for b_name, b_info in backends.items(): 
        rpm_limit = b_info.get("rpm_limit")
        if rpm_limit is not None:
            prob += pulp.lpSum(x[task["id"], b_name] for task in tasks) <= rpm_limit 

    # Solve the MILP problem
    solver = pulp.PULP_CBC_CMD(msg=False)
    prob.solve(solver)

    # Check solver status
    if prob.status != pulp.LpStatusOptimal:
        raise ValueError(
            f"The MILP problem is infeasible or cannot be solved optimally. "
            f"Status: {pulp.LpStatus[prob.status]}"
        )

    # Extract the assignments
    result = {}
    for task in tasks:
        t_id = task["id"]
        assigned = None
        for b_name in backends.keys():
            val = x[t_id, b_name].varValue
            if val is not None and abs(val - 1.0) < 1e-5:
                assigned = b_name
                break
        if assigned is None:
            raise ValueError(f"Task {t_id} was not assigned to any backend.")
        result[t_id] = assigned

    return result

