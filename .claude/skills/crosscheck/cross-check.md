---
name: cross-check
description: After Claude implements code, Codex reviews the diff. If issues are found Claude proposes fixes, you approve them, then Codex re-reviews. Loops until Codex is satisfied or user intervenes. Use after implementation is complete before committing.
---

# Cross-check: Codex review loop

You have just finished implementing. Do not commit until this protocol completes.

## 1. Confirm scope
Run:
```
git diff HEAD
```
Show the user a summary of which files changed. If there are no uncommitted changes, stop — there is nothing to review.

## 2. Codex review

**Round 1** — fresh session:
```
codex --full-auto exec --sandbox read-only "You are a senior engineer doing an independent code review of changes made by another AI (Claude Code). Review the uncommitted changes using git diff HEAD.

For each issue found state: file and line range, severity (critical / warning / nit), and a concrete suggested fix.

First line of your response must be APPROVED or ISSUES FOUND.
If APPROVED, say so and explain briefly why the code looks good.
If ISSUES FOUND, list them grouped by severity: critical first, then warnings, then nits.

Do not modify any files."
```

**Round 2+** — after fixes have been applied, resume so Codex has context of what it previously flagged:
```
codex exec resume --last "Claude has addressed the approved findings. Re-review the updated diff using git diff HEAD. Same format: APPROVED or ISSUES FOUND on the first line, then findings."
```

Quote Codex's response verbatim each round, with recommendation if we should accept or deny the results found.

## 3. Human checkpoint

After each Codex response, if ISSUES FOUND:

Present the findings clearly, grouped by severity. Then ask:
**"Should I fix these issues? (yes / no / select)"**

- **yes** → propose your intended fixes explicitly — show the user exactly what you plan to change and why, then wait for confirmation before touching any files
- **no** → stop, let the user commit as-is
- **select** → list findings numbered, let the user pick which to address, then propose fixes for selected items and wait for confirmation before touching any files

**Do not modify any file until the user has explicitly confirmed the proposed fixes.**

## 4. Fix, then loop

Once the user confirms fixes:
- Apply them
- Resume Codex session and re-review (back to step 2 round 2+)
- After **3 rounds** with unresolved issues: stop looping, present outstanding issues to the user, and ask how to proceed

## 5. Done
Tell the user:
- How many rounds it took
- What was fixed
- What was left unaddressed (nits or user-skipped items)

Then confirm: **"Code is clear to commit."**