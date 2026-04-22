---
name: Project layout
description: GymBro two-repo layout and DB treatment during beta
type: project
---

Two sibling repos under `E:\Work\VSCode Repo\`:
- `GBBackend` — Express + `pg` backend. Entry: `server.js`. DB helper: `db.js`. Schema note: `pg_sql.txt` (authoritative seed/schema reference).
- `GymBro` — client app; code lives in `GymBro/gymbro/`.

**Why:** The user treats `pg_sql.txt` as the canonical DB spec and will wipe + reseed the deployed DB from it. That means schema migrations do not need backwards-compatibility (no ALTER with backfill gymnastics) — just update `pg_sql.txt` and keep server queries consistent.

**How to apply:** When changing schema, edit `pg_sql.txt` (both CREATE TABLE and mock INSERTs) and update all server queries. No migration scripts needed unless explicitly requested.
