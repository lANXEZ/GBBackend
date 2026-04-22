---
name: Fix batch Apr 2026
description: Large upgrade batch; decisions captured so execution can proceed in phases without re-asking
type: project
---

Source: `E:\Work\GB Fix list.txt` (plus two follow-up items on progressive overload and progressType). Clarified decisions:

- `suggestsetamount` is a **nullable text** column on `exercisemove` (not int). Free-form; AI prompted to use `int-int` format; manual entry allowed any text. Placeholder: `eg. 3-5 sets.`. Display: `Suggested set amount: {value}`. Show: workout page expanded plan, plan-picker post-"Start workout", and above "Continue with more sets" during exercising. Hide entirely if null.
- `sex` column on `users`: single char `CHECK (sex IN ('m','f'))`, NOT NULL. DB will be wiped + reseeded from `pg_sql.txt`; mock users all male except `testClient` = female. AI plan prompt includes sex + age (from DOB) but does not specialize `suggestsetamount` by user — exercises stay universal.
- Token expiry stays 24h; add client-side popup when a 401/expired token is detected, prompting re-login.
- Username collision: live check via new endpoint (debounced), plus disable registration confirm while invalid.
- Send exercise move: mirror send-plan UI, duplicate row verbatim with receiver's userID, auto-increment exmoveid, silently allow duplicates.
- Registration: add sex selector; password field uses dotted placeholder matching create-account popup; eye-toggle on all password fields.
- Manual exercise creation: `steps` optional (remove `*`); optional suggestsetamount field.
- Home page empty-state: the word "active" (or equivalent) is a link that shows a small tooltip — no navigation — explaining activation requires starting a session with the plan at least once.
- Execution order (user approved): Phase A = schema + `pg_sql.txt`; Phase B = backend endpoints/logic; Phase C = client UI. Check in briefly after A and B.

**Why:** User answered a round of clarifying questions up front; treating these as binding so execution is not repeatedly interrupted.

**How to apply:** Follow these decisions rather than re-asking. If something new comes up that conflicts, surface it then.
