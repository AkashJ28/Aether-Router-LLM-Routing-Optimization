# pyrefly: ignore [missing-import]
import pytest
from backend.optimizer.complexity import classify_complexity

TEST_CASES = [
    ("Translate this paragraph into French", "low"),
    ("Summarize this research paper in 3 bullet points", "medium"),
    ("Solve this DSA problem: find the longest increasing subsequence", "high"),
    ("Generate a SQL query to join two tables", "medium"),
    ("Write a professional email declining a meeting", "low"),
    ("Explain recursion with an example", "medium"),
    ("Prove that the square root of 2 is irrational", "high"),
    ("Convert this CSV to JSON format", "low"),
    ("Debug this Python function that throws an IndexError", "high"),
    ("Rephrase this sentence to sound more formal", "low"),
    ("Compare the time complexity of quicksort and mergesort", "high"),
    ("What's the capital of France", "low"),
    ("Write a function that computes the nth Fibonacci number using dynamic programming and explain its time complexity", "high"),
    ("Capitalize the first letter of every word in this list", "low"),
    ("Given this dataset, optimize the delivery routes for 5 trucks visiting 20 cities", "high"),
]

@pytest.mark.parametrize("query,expected_label", TEST_CASES)
def test_complexity_rubric(query, expected_label):
    assert classify_complexity(query) == expected_label
