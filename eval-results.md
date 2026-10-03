# Eval results

Generated: 2026-10-03T23:27:34.987Z
Model config: PRIMARY_MODEL=(default cascade), DISABLE_FALLBACK=false

**Verified: 9/9** (excluding 0 infra/harness errors). False "success" claims caught by the verifier: 0.

| ID | Scenario | Runs | Verified | False success | Avg steps | Avg calls | Avg tokens | Fallback events | Asks |
|---|---|---|---|---|---|---|---|---|---|
| SC-01 | Single JSON invoice entry (ERP) | 1 | 1/1 | 0 | 8 | 8 | 14838 | 0 | 1 |
| SC-02 | Unreliable filenames, paid invoice skipped | 1 | 1/1 | 0 | 14 | 14 | 39815 | 8 | 1 |
| SC-03 | PDF invoice parsing | 1 | 1/1 | 0 | 8 | 8 | 16405 | 0 | 1 |
| SC-04 | Incomplete invoice flagged, valid one submitted | 1 | 1/1 | 0 | 13 | 13 | 38750 | 12 | 1 |
| SC-05 | Healthcare claim submission | 1 | 1/1 | 0 | 11 | 11 | 26057 | 9 | 1 |
| SC-06 | Chaos: validation error | 1 | 1/1 | 0 | 8 | 8 | 15454 | 3 | 1 |
| SC-07 | Chaos: session timeout | 1 | 1/1 | 0 | 8 | 8 | 15054 | 10 | 1 |
| SC-08 | Chaos: flaky submit | 1 | 1/1 | 0 | 9 | 9 | 17036 | 0 | 2 |
| SC-09 | Approval denied: nothing may be created | 1 | 1/1 | 0 | 8 | 8 | 15099 | 7 | 1 |

## Per-run detail

| ID | Run | Agent said | Verdict | Steps | Calls | Models | Secs | Reasons |
|---|---|---|---|---|---|---|---|---|
| SC-01 | 1 | success | verified | 8 | 8 | gemini-3.5-flash-litex8 | 14 | Record successfully matched all expectations. |
| SC-02 | 1 | success | verified | 14 | 14 | gemini-3.5-flash-litex11, gemini-3-flash-previewx1, gemini-3.6-flashx2 | 61 | Record successfully matched all expectations. |
| SC-03 | 1 | success | verified | 8 | 8 | gemini-3.5-flash-litex8 | 14 | Record successfully matched all expectations. |
| SC-04 | 1 | success | verified | 13 | 13 | gemini-3.5-flash-litex7, gemini-3-flash-previewx6 | 42 | Record successfully matched all expectations. |
| SC-05 | 1 | success | verified | 11 | 11 | gemini-3.5-flash-litex6, gemini-3-flash-previewx4, gemini-flash-lite-latestx1 | 43 | Claim matched all expectations. |
| SC-06 | 1 | success | verified | 8 | 8 | gemini-flash-lite-latestx1, gemini-3-flash-previewx1, gemini-3.5-flash-litex6 | 26 | Record successfully matched all expectations. |
| SC-07 | 1 | success | verified | 8 | 8 | gemini-3.5-flash-litex4, gemini-3-flash-previewx3, gemini-3.1-flash-litex1 | 47 | Record successfully matched all expectations. |
| SC-08 | 1 | success | verified | 9 | 9 | gemini-3.5-flash-litex9 | 17 | Record successfully matched all expectations. |
| SC-09 | 1 | failed | verified | 8 | 8 | gemini-3.5-flash-litex6, gemini-3.6-flashx1, gemini-3.1-flash-litex1 | 36 | Record successfully matched all expectations. |
