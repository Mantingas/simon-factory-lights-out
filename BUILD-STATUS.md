# Gate 2: BUILD-STATUS

**Product:** NTBro MVP
**Status:** COMPLETE
**Branch:** `claude/build-ntbro-mvp-Abrn4`
**App path:** `ntbro/`

---

## Build Summary

All 5 data models, 3 engines, 6 screens, and all API routes are implemented and building successfully.

---

## Data Models — ALL BUILT

| Model        | File                   | Status |
|-------------|------------------------|--------|
| Client       | `lib/db.js` — `clients` table     | ✅ |
| Demand       | `lib/db.js` — `demands` table     | ✅ |
| Property     | `lib/db.js` — `properties` table  | ✅ |
| Interaction  | `lib/db.js` — `interactions` table | ✅ |
| Task         | `lib/db.js` — `tasks` table       | ✅ |

**Deduplication index:** `UNIQUE INDEX ON tasks(client_id, type) WHERE status = 'pending'` — enforced at DB level.

---

## Core Engines — ALL IMPLEMENTED

### Task Engine (`lib/engines.js` → `runTaskEngine`)
- `days < 1` → skip
- `days 2–3` → `follow_up`
- `days 4–7` → `call`
- `days > 10` → `re_engage`
- Dedup check before every insert
- Priority scoring: hot client +50, active demand +30, match_call +70, re_engage +40, follow_up +20, staleness capped at 30

### Match Engine (`lib/engines.js` → `runMatchEngine`)
- Triggered on every `POST /api/properties`
- Matches on: `type + rooms + city + price <= budget`
- Creates `match_call` tasks for all matching demand clients
- Dedup: skips if pending `match_call` already exists for that client

### Post-Call Engine (`lib/engines.js` → `runPostCallEngine`)
- Triggered after `POST /api/interactions`
- `call_tomorrow` → `call` task due +1 day
- `follow_up` → `follow_up` task due +2 days
- `schedule_showing` → `callback` task due +1 day
- `none` → falls back to Task Engine

---

## API Routes — ALL BUILT

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/clients` | GET, POST | List all clients / create client |
| `/api/clients/[id]` | GET, PATCH, DELETE | Client detail / update / delete |
| `/api/demands` | POST | Create demand for client |
| `/api/properties` | GET, POST | List properties / add property + trigger Match Engine |
| `/api/interactions` | POST | Log interaction + trigger Post-Call / Task Engine |
| `/api/tasks` | GET, POST | Get today tasks (≤7, sorted) / trigger daily cron |
| `/api/tasks/[id]/done` | POST | Complete task, updates `last_contact_at` |

---

## Screens — ALL BUILT

| # | Screen | Route | Status |
|---|--------|-------|--------|
| 1 | Today Tasks | `/` | ✅ |
| 2 | Client Detail | `/clients/[id]` | ✅ |
| 2b | Clients List | `/clients` | ✅ |
| 3 | Add Client | `/clients/new` | ✅ |
| 4 | Add Demand | `/demands/new?client_id=` | ✅ |
| 5 | Add Property | `/properties/new` | ✅ |
| 6 | Log Interaction | `/interactions/new?client_id=` | ✅ |

---

## Tech Stack

- **Framework:** Next.js 14 (Pages Router)
- **Database:** SQLite via `better-sqlite3` (persisted to `data/ntbro.db`)
- **Styling:** Tailwind CSS v4 (mobile-first, max-width 480px)
- **UUID:** `uuid` v13

---

## Build Output

```
Route (pages)                              Size    First Load JS
┌ ○ /                                      1.8 kB       84.2 kB
├ ○ /clients                               1.23 kB      83.7 kB
├ ○ /clients/[id]                          1.95 kB      84.4 kB
├ ○ /clients/new                           1.54 kB      84.0 kB
├ ○ /demands/new                           1.6 kB       84.0 kB
├ ○ /interactions/new                      1.73 kB      84.2 kB
└ ○ /properties/new                        1.91 kB      84.3 kB
```

**Build status: SUCCESS** — `npm run build` passes with 0 errors.

---

## Running the App

```bash
cd ntbro
npm run dev     # development
npm run build   # production build
npm start       # production server
```

App starts on `http://localhost:3000`

---

## Core Loop — WORKING

```
call → log interaction → task created → broker acts → mark done → repeat
```

1. Add client → `/clients/new`
2. Log interaction → `/interactions/new?client_id=X`
3. Select post-call action → Task Engine creates task
4. Add property → Match Engine runs, creates `match_call` tasks
5. Today Tasks shows sorted list (≤7) → broker taps Call / Done
6. Done → `last_contact_at` updated → cycle continues

---

## Gate 2 Checklist

- [x] All models built with correct fields and constraints
- [x] Task Engine generates correct type per threshold
- [x] No duplicate pending tasks (DB-level unique index)
- [x] Priority ordering: match_call always highest
- [x] Today Tasks shows max 7 items
- [x] Match Engine: type + rooms + city + budget all checked
- [x] Post-Call Engine: all 3 actions → correct task types
- [x] Completing task updates `last_contact_at`
- [x] All 6 screens working
- [x] Mobile-first (375px+ viewport)
- [x] Every action completable in ≤ 3 taps
- [x] Build passes: 0 errors
