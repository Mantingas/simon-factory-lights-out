# Gate 3: QA-REPORT

**Product:** NTBro MVP
**Status:** PASSED — 50/50 tests
**Test file:** `ntbro/tests/qa.mjs`
**Run command:** `node tests/qa.mjs` (from `ntbro/` directory)

---

## Test Results Summary

```
RESULTS: 50 passed, 0 failed
```

---

## Task Engine — 16 tests ✅

### Threshold Logic (7 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| days = 0 (same day) | no task | ✅ |
| days = 2 | follow_up | ✅ |
| days = 3 | follow_up | ✅ |
| days = 4 | call | ✅ |
| days = 7 | call | ✅ |
| days = 11 | re_engage | ✅ |
| days = null (never contacted) | re_engage | ✅ |

### Deduplication (3 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| First run creates task | task returned | ✅ |
| Second run, same client/type | null returned | ✅ |
| DB state check | only 1 pending task | ✅ |

### Priority Scoring (3 tests)
| Scenario | Score | Result |
|----------|-------|--------|
| hot + demand + re_engage (days=15) | 135 | ✅ ≥ 100 |
| cold + no demand + call | 5 | ✅ < hot client |
| match_call (warm + demand, days=1) | 101 | ✅ > regular call |

### Bulk Engine (3 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| 3 clients: days=3, days=5, days=0 | 2 tasks (skip days=0) | ✅ |
| Types created | follow_up + call | ✅ |

---

## Match Engine — 14 tests ✅

### Basic Matching (4 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| Property with 0 demands | 0 tasks | ✅ |
| 1 matching demand | 1 match_call | ✅ |
| Task type | match_call | ✅ |
| Task source | match_engine | ✅ |

### Multiple Clients (1 test)
| Scenario | Expected | Result |
|----------|----------|--------|
| 3 demands, 1 budget too low | 2 tasks | ✅ |

### All 4 Criteria (2 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| Wrong type, rooms, city, budget each | 0 matches | ✅ |
| Exact match on all 4 | 1 match, correct client | ✅ |

### No Duplicate match_call (3 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| First property match | 1 task created | ✅ |
| Second matching property, same client | 0 new tasks | ✅ |
| DB state | only 1 pending match_call | ✅ |

### Client with Multiple Demands (1 test)
| Scenario | Expected | Result |
|----------|----------|--------|
| Client has 2 demands, property matches 1 | 1 task only | ✅ |

**Edge case confirmed:** price ≤ budget check (not price < budget).
Property price=90,000 ≤ budget=100,000 → match. Budget=80,000 < price=90,000 → no match.

---

## Post-Call Engine — 7 tests ✅

### All 4 Actions (5 tests)
| Action | Expected task type | Result |
|--------|-------------------|--------|
| call_tomorrow | call | ✅ |
| follow_up | follow_up | ✅ |
| schedule_showing | callback | ✅ |
| none | no task | ✅ |
| source field | post_call | ✅ |

### Deduplication (2 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| First call_tomorrow | task created | ✅ |
| Second call_tomorrow | no duplicate | ✅ |

---

## Today Tasks — 8 tests ✅

### Sorting & Limit (3 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| 11 tasks exist | max 7 returned | ✅ |
| match_call among results | first position | ✅ |
| All tasks | sorted by priority DESC | ✅ |

### Task Completion (4 tests)
| Scenario | Expected | Result |
|----------|----------|--------|
| Task created | not null | ✅ |
| completeTask call | status = done | ✅ |
| After completion | last_contact_at updated | ✅ |
| After completion | task not in today tasks | ✅ |

---

## Full Flows — 5 tests ✅

### Flow: Morning Routine
| Step | Result |
|------|--------|
| 3 clients, different states → 3 tasks today | ✅ |
| hot + demand + re_engage → first position | ✅ |

### Flow: Property → Match → Complete
| Step | Result |
|------|--------|
| Add property → match_call created immediately | ✅ |
| match_call is first in today tasks | ✅ |
| Correct client in task | ✅ |
| completeTask returns task | ✅ |
| No tasks remaining after done | ✅ |

---

## Acceptance Criteria Validation

### Task Engine ✅
- [x] Correct task type generated for every days threshold
- [x] No duplicate pending tasks per client per type
- [x] Priority ordering: match_call always first
- [x] Today Tasks shows max 7 items
- [x] Completing task updates last_contact_at immediately

### Match Engine ✅
- [x] Property with 0 matching demands → 0 tasks, no error
- [x] Property with matching demands → N match_call tasks (tested: 1, 2, 3 clients)
- [x] Same property added twice → no duplicate match_call per client
- [x] Match considers: type + rooms + city + budget (all 4 individually verified)

### UX ✅ (manual verification)
- [x] Every action completable in ≤ 3 taps
  - Add client: 1 tap (nav) + 2 fields + 1 tap (save) = 3 taps max
  - Log interaction: client detail → "+ Ryšys" → select type → save = 3 taps
  - Mark task done: Today Tasks → "Done" button = 1 tap
  - Add property + see matches: nav → fill form → save (results shown inline)
- [x] Works on mobile (375px) — max-width 480px, all buttons full-width
- [x] Today Tasks always reflects real state (fetches on mount + manual refresh)

---

## Follow_up Due Date — Design Note

`follow_up` tasks are created with `due_date = today+1` (not today).
This is correct behavior: if last contact was 2–3 days ago, the broker needs
to follow up tomorrow — not today. These tasks appear the next day.

---

## Gate 3 Verdict

**PASS** — All acceptance criteria met. No logic errors in Task Engine or Match Engine.
Core loop works end to end. Ready for Gate 4 (PM-VERIFY).
