---
name: Progressive overload rules
description: Detection logic and progressType conventions for the workout coordinator
type: project
---

**Progressive overload detection** — runs in the workout coordinator **after** the struggle check. If struggle fires, skip overload (safety first).

Fetch the 4 most recent **completed** sessions where `session.exmoveid == current.exmoveid`, excluding the in-progress session. If fewer than 4 exist → skip silently.

Decision rule (no PR comparison — purely trend over the 4):
- `progressType = 'increase'`: if across all 4 sessions, **no metric** (weight, reps, time, sets) ever improved (i.e. every metric is flat or decreasing across the window) → notify.
- `progressType = 'decrease'`: flip — if across all 4 sessions, **no metric** ever decreased (everything flat or higher) → notify.
- If **any** single metric shows improvement in **any** of the 4 sessions → do not notify.

Notification: same popup component as struggle, different copy (generic "consider increasing intensity"), softer/non-danger color.

New endpoint mirrors `/api/workout/is-struggle` — shape TBD during implementation.

**progressType AI restriction:** AI prompt must force `progressType ∈ {"increase","decrease"}`. Server validates/rejects any other value. Convention: `increase` = doing more is better (most strength moves); `decrease` = doing less is better (e.g., faster 1km run).

**Why:** User specified these rules precisely in the clarification round; the "4-session trend, AND across metrics" framing is the load-bearing part.

**How to apply:** When touching the workout coordinator or AI generate-plan prompts, enforce exactly this. Do not widen to PR-based logic or per-metric notifications.
