---
name: coplan
description: Collaborative planning with Codex review. Use when user wants to plan and implement a significant feature, task, or change with multi-agent review before any code is written.
---

# Collaborative Planning Protocol

You are entering collaborative planning mode for: $ARGUMENTS

Do NOT write any code until this protocol completes.

## 1. Investigate
Explore the codebase relevant to the task. Understand existing patterns, file structure, dependencies, and conventions. Take your time here — the quality of the plan depends on understanding what already exists.

## 2. Draft a plan
Write a detailed markdown plan covering:
- Which files to create or modify
- Approach and reasoning
- Potential risks or edge cases
- Order of operations

## 3. Codex review loop

**Round 1** — start a fresh Codex session:
```
codex --full-auto exec "You are a senior engineer reviewing an implementation plan. First line of your response must be APPROVED or REVISE. Then bullet your specific concerns or suggestions. Plan:\n\n<your plan>"
```

**Round 2+** — resume the same session so Codex has full context of prior exchange:
```
codex exec resume --last "Here is the revised plan addressing your concerns. Re-review and again reply APPROVED or REVISE on the first line:\n\n<updated plan>"
```

IMPORTANT: If codex responds with REVISE, concisely inform the user of the issues codex finds, with recommendation if we should accept or deny the results found.

- If **REVISE**: address each concern, update the plan, run the resume command again
- If **APPROVED**: move to step 4
- After **3 rounds** with no agreement: stop looping, show the user both positions side by side, and ask them to decide how to proceed

## 4. Human checkpoint
Present:
- The final agreed plan in full
- How many rounds it took
- A brief summary of what changed between v1 and the final version

Then ask: **"Do you approve this plan? (yes / edit / no)"**

Do not proceed until the user explicitly responds.

- **yes** → go to step 5
- **edit** → accept their edits, confirm the updated plan, then go to step 5
- **no** → ask what they'd like to change and restart from step 2

## 5. Implement
Only now — implement the approved plan step by step. Follow the order of operations defined in the plan.