# AI Evaluations

This directory contains evaluation tests for the AI capabilities of OpenReview.

For every new feature or LLM prompt change built, an accompanying AI evaluation must be written here to empirically measure its success rate against a known baseline.

## Philosophy

- **Deterministic Verification:** As much as possible, verify structured outputs.
- **Heuristic Checks:** For natural language outputs, use heuristic string matching or LLM-as-a-judge to verify if the model captured the required intent.
- **Test Fixtures:** Use code fixtures in `tests/fixtures/` with known bugs/patterns to test the AI's detection capabilities.
