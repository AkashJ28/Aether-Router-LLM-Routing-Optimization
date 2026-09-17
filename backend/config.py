import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure project root is in sys.path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# Load environment variables from root or backend .env
_env_path = _PROJECT_ROOT / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path)
else:
    load_dotenv()

# config.py
# Provider limits captured on 2026-08-10; verify before final experiments.

BACKENDS = {
    "local": {
        "cost_per_1k_tokens": 0.0,
        "latency_s": 1.98,
        "rpm_limit": None,       # unlimited for this project model
        "tpm_limit": None,
        "rpd_limit": None,
        "capability": 1,
        "base_url": "http://localhost:11434/v1",
        "model": "llama3.2:1b",
    },
    "groq": {
        "cost_per_1k_tokens": 0.0,
        "latency_s": 0.36,
        "rpm_limit": 30,
        "tpm_limit": 6000,
        "rpd_limit": 14400,
        "capability": 2,
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.1-8b-instant",
    },
    "gemini": {
        "cost_per_1k_tokens": 0.0,
        "latency_s": 1.53,
        "rpm_limit": None,       # not modeled because a stable RPM value is not used
        "tpm_limit": 250000,
        "rpd_limit": 1500,
        "capability": 5,
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-2.5-flash",
    },
}
