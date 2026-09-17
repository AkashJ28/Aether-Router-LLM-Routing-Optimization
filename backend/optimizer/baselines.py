def baseline_always_gemini(tasks: list[dict]) -> dict[int, str]:
    """
    Baseline 1: Always use the highest-capability backend (Gemini).
    Maps every task ID to "gemini".
    """
    return {task["id"]: "gemini" for task in tasks}

def baseline_rule_based(tasks: list[dict]) -> dict[int, str]:
    """
    Baseline 2: Fixed rule-based routing.
    Low -> "local"
    Medium -> "groq"
    High -> "gemini"
    """
    mapping = {}
    for task in tasks:
        complexity = task["complexity"].lower()
        if complexity == "low":
            mapping[task["id"]] = "local"
        elif complexity == "medium":
            mapping[task["id"]] = "groq"
        else:
            # high complexity or any unknown default goes to gemini
            mapping[task["id"]] = "gemini"
    return mapping
