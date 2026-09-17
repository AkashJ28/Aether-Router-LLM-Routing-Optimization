import pulp

def solve(tasks: list[dict], backends: dict) -> dict[int, str]:
    """
    Solves the LLM routing problem using Mixed Integer Linear Programming (MILP).
    
    tasks:    [{"id": 1, "complexity": "low"},
               {"id": 2, "complexity": "high"}, ...]
    backends: config.BACKENDS dict containing latency_s, capability, rpm_limit, etc.
    Returns:  {1: "local", 2: "gemini", ...}
    Raises a ValueError if the problem is infeasible.
    """
    if not tasks:
        return {}

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

    # Objective Function: Minimize total service latency
    objective_terms = []
    for task in tasks:
        t_id = task["id"]
        for b_name, b_info in backends.items():
            latency = b_info.get("latency_s")
            if latency is None:
                raise ValueError(
                    f"Backend '{b_name}' has no latency configured (latency_s is None). "
                    "Please measure and update its latency before optimization."
                )
            objective_terms.append(latency * x[t_id, b_name])
            
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
