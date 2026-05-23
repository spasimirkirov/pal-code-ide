# Agent Tool Conformance

This folder contains deterministic conformance scenarios for tool-driven agent behavior.

## Files

- `agent-tool-conformance-100.json`: 100 benchmark cases covering
  - native function tool usage
  - strict schema conformance
  - hallucinated path blocking
  - terminal approval safety
  - fallback behavior when native tools are unavailable

## Suggested scoring

For each case, record:

- pass/fail
- selected tools
- schema validation errors
- blocked hallucinations
- execution outcome
- final assistant response quality

Aggregate metrics:

- tool_selection_accuracy
- schema_validity_rate
- hallucinated_path_block_rate
- action_success_rate
- unsafe_terminal_block_rate
- final_answer_after_tools_rate
