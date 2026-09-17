import os
import sys

# Ensure backend/ is in the Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.config import BACKENDS
from backend.clients.llm_client import LLMClient

def main():
    prompts = [
        "What is the capital of France?",
        "Write a short Python function to reverse a string.",
        "Explain the concept of an API."
    ]

    print("=====================================================================")
    # Print system check
    print("Initiating LLM Latency Measurement Experiment...")
    print("Prompts:")
    for i, p in enumerate(prompts, 1):
        print(f"  {i}. {p}")
    print("=====================================================================\n")

    client = LLMClient()
    results = {}

    for backend in ["local", "groq", "gemini"]:
        print(f"Testing backend: '{backend}'...")
        latencies = []
        errors = []
        
        for idx, prompt in enumerate(prompts):
            print(f"  -> Sending prompt {idx+1}/3... ", end="", flush=True)
            res = client.call(backend, prompt)
            
            if res.get("error"):
                errors.append(res["error"])
                print(f"FAILED (Error: {res['error'][:50]}...)")
            else:
                latencies.append(res["latency_s"])
                print(f"SUCCESS ({res['latency_s']:.2f} s)")

        if latencies:
            avg_latency = sum(latencies) / len(latencies)
            results[backend] = {
                "avg_latency": f"{avg_latency:.4f} s",
                "status": f"Success ({len(latencies)}/3 calls)",
                "raw_avg": avg_latency
            }
        else:
            results[backend] = {
                "avg_latency": "N/A",
                "status": "Failed (0/3 calls)",
                "raw_avg": None
            }
        print()

    # Print Formatted Table
    print("=====================================================================")
    print(f"{'Backend':<12} | {'Average Latency':<18} | {'Status/Success Rate':<22}")
    print("---------------------------------------------------------------------")
    for backend, info in results.items():
        print(f"{backend:<12} | {info['avg_latency']:<18} | {info['status']:<22}")
    print("=====================================================================\n")

    # Suggestion on updating config.py
    print("Tip: You can now update the 'latency_s' field in backend/config.py")
    print("with these measured averages to calibrate the MILP solver.")

if __name__ == "__main__":
    main()
