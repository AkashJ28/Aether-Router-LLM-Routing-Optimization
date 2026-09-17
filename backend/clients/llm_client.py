import os
import sys
import time
from pathlib import Path

# Ensure project root is in sys.path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from openai import OpenAI
from backend.config import BACKENDS

class LLMClient:
    def __init__(self):
        self.clients = {}

    def _get_client(self, backend: str) -> OpenAI:
        if backend in self.clients:
            return self.clients[backend]

        backend_info = BACKENDS.get(backend)
        if not backend_info:
            raise ValueError(f"Unknown backend: {backend}")

        # Retrieve API key based on backend configuration
        if backend == "local":
            api_key = "ollama"  # Ollama needs no key, pass a dummy string for the SDK
        elif backend == "groq":
            api_key = os.environ.get("GROQ_API_KEY", "")
        elif backend == "gemini":
            api_key = os.environ.get("GEMINI_API_KEY", "")
        else:
            api_key = ""

        # Initialize the OpenAI client with proper base URL and API key
        client = OpenAI(
            base_url=backend_info["base_url"],
            api_key=api_key
        )
        self.clients[backend] = client
        return client

    def call(self, backend: str, prompt: str) -> dict:
        """
        backend: one of "local", "groq", "gemini"
        Returns:
        {
            "text": str,
            "latency_s": float,       # measured wall-clock response time
            "backend": str,
            "model": str,
            "error": str | None       # populated on failure, e.g. 429
        }
        """
        backend_info = BACKENDS.get(backend)
        if not backend_info:
            return {
                "text": "",
                "latency_s": 0.0,
                "backend": backend,
                "model": "unknown",
                "error": f"Unknown backend '{backend}'"
            }

        model = backend_info["model"]
        start_time = time.perf_counter()

        try:
            client = self._get_client(backend)
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=150,  # limit length to conserve rate limit / tokens
            )
            text = response.choices[0].message.content or ""
            latency_s = time.perf_counter() - start_time
            return {
                "text": text,
                "latency_s": latency_s,
                "backend": backend,
                "model": model,
                "error": None
            }
        except Exception as e:
            latency_s = time.perf_counter() - start_time
            return {
                "text": "",
                "latency_s": latency_s,
                "backend": backend,
                "model": model,
                "error": str(e)
            }
