---
name: constructa-documentation-update
description: Use when updating documentacion.md to record progress, decisions, bugs, fixes, or analysis performed during any CONSTRUCTA development session.
---

## When to use this skill

- At the end of ANY task (code changed or not)
- When recording a debugging session
- When recording a professor/teacher feedback review
- When recording architectural decisions
- When recording deferred or rejected changes
- When adding traceability to a completed feature

This skill is not standalone — it is the final step of every other skill.

---

## Files to read first

```
documentacion.md                 — current state (read the last 3-5 entries for context)
```

---

## Rules for documentation

### Document every session — no exceptions
Even if no code was changed, document:
- What was analyzed
- What decisions were made
- Why no change was applied

Silence in the documentation log means future agents cannot understand why the system is in its current state.

### Use absolute dates
Always use `YYYY-MM-DD` format. Never use "yesterday", "last week", or relative references.

### Be specific about files
Do not write "modified several files". List every file changed.

### Reference patterns and rules when applicable
If a fix applied BS-03 or a change was rejected because of DR-01, say so.
This connects the documentation to the established ruleset.

### Document root causes, not just symptoms
"Fixed the PATCH endpoint" is not enough.
"Fixed the PATCH endpoint — root cause was BS-03 violation (state captured after session.refresh mutated the in-memory object)" is useful.

---

## Documentation template

Every entry in `documentacion.md` must follow this exact template:

```markdown
## YYYY-MM-DD — Short task title

### Objective
One paragraph describing what was implemented, reviewed, or investigated and why.

### Changes made
Summary of what was done (bullet list):
- Feature/fix description
- Additional change

### Files modified
Complete list of every file changed:
- `backend/app/services/task_service.py` — description of change
- `frontend/src/components/GanttTimeline.tsx` — description of change

### Problems found
Bugs, unexpected behavior, or architecture gaps discovered during the task.
If none: "No issues encountered."

### Solutions applied
How each problem was resolved. Include rule references where applicable.
If no changes: "No changes applied — see rationale in 'Changes made'."

### Validation
Commands run and their results:
- `python3 -c "from app.main import app; print('imports OK')"` — OK
- `npm run build` — passed with 0 errors
- Manual test: [describe the flow tested] — [result]

### Pending / next steps
Explicit list of what remains to be done. If nothing: "None — feature complete."
Do NOT leave this section empty. Empty = forgot to think about next steps.
```

---

## Step-by-step process

### Step 1 — Read the last 3-5 entries in documentacion.md
Understand the recent state of the project before writing.
Check if there are open "Pending / next steps" items that were just completed.

### Step 2 — Fill the template
Go section by section. Do not skip sections.

### Step 3 — Update "Pending / next steps" from the previous entry
If the task you just completed was listed as "next steps" in a previous entry, note that it was completed.

### Step 4 — Append the entry at the bottom of documentacion.md
Always append. Never delete or modify previous entries.
The file is an append-only log.

### Step 5 — Review the table of contents (if documentacion.md has one)
If the file has a header index/TOC, add the new entry to it.

---

## What to document even when no code was changed

Sometimes the most important documentation is for tasks where nothing changed:

**Analysis performed:**
- Which files were read
- What patterns were identified

**Decisions made:**
- "Decided NOT to apply X because Y"
- "Classified change as FUTURE because it requires Phase 3"
- "Rejected rename of field Z because it would break frontend type alignment"

**Why no change was applied:**
- "Professor proposed adding `priority` field. Classified as FUTURE — deferred until explicitly scheduled."
- "Investigated 500 error on PATCH. Root cause is the existing BS-03 violation in obra_service.py which was already fixed in the previous session. No new change needed."

---

## Documentation quality checklist

Before finalizing the entry, verify:

- [ ] Date is in YYYY-MM-DD format
- [ ] Title is descriptive (not "fix bug" but "Fix 500 on PATCH tasks — date JSON serialization")
- [ ] Every modified file is listed
- [ ] Root cause (not just symptom) is documented for any bug fix
- [ ] Validation section includes actual command output or result
- [ ] "Pending / next steps" is filled — not left empty
- [ ] No relative date references ("yesterday", "last session")
- [ ] Rule references included where applicable (BS-03, DR-01, etc.)

---

## Common mistakes to avoid

| Mistake | Consequence | Fix |
|---|---|---|
| Skipping documentation because "it was a small change" | Future agents have no context | Document every change, no matter how small |
| Writing "modified some files" | Traceability lost | List every file by path |
| Leaving "Pending / next steps" empty | Future session starts without direction | Always write at least one line |
| Using relative dates | Entry becomes unreadable after time passes | Always use YYYY-MM-DD |
| Documenting only what was done, not why | Architecture decisions are lost | Explain rationale, reference rules |
| Not documenting rejected changes | Future agents may re-propose the same rejected change | Document FUTURE/REJECTED with reasoning |

---

## End-of-task documentation requirement

This skill IS the documentation requirement. When using this skill, the output IS the entry in `documentacion.md`.

After writing the entry:
- Confirm the file was saved
- Confirm the date is correct
- Confirm "Pending / next steps" is not empty
