/**
 * NTBro QA — Gate 3 Test Suite
 * Run: node tests/qa.mjs  (from ntbro/ directory)
 */

import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { migrate } from '../lib/db.js'
import {
  runTaskEngine,
  runTaskEngineForAllClients,
  runMatchEngine,
  runPostCallEngine,
  getTodayTasks,
  completeTask,
} from '../lib/engines.js'

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${label}`)
    failed++
    failures.push(label)
  }
}

function section(title) {
  console.log(`\n── ${title} ──`)
}

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createClient(db, { status = 'warm', last_contact_at = null } = {}) {
  const id = uuidv4()
  db.prepare(`
    INSERT INTO clients (id, name, phone, status, last_contact_at)
    VALUES (?, 'Test Client', '+37060000000', ?, ?)
  `).run(id, status, last_contact_at)
  return id
}

function createDemand(db, clientId, { type = 'apartment', rooms = 2, city = 'Vilnius', budget = 100000 } = {}) {
  const id = uuidv4()
  db.prepare(`
    INSERT INTO demands (id, client_id, type, rooms, city, budget)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, clientId, type, rooms, city, budget)
  return id
}

function createProperty(db, { type = 'apartment', rooms = 2, city = 'Vilnius', price = 90000 } = {}) {
  const id = uuidv4()
  db.prepare(`
    INSERT INTO properties (id, type, rooms, city, price)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, type, rooms, city, price)
  return id
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ─── Task Engine Tests ────────────────────────────────────────────────────────

section('TASK ENGINE — threshold logic')

{
  const db = freshDb()

  // days < 1 → no task
  const c1 = createClient(db, { last_contact_at: daysAgo(0) })
  const t1 = runTaskEngine(db, c1)
  assert(t1 === null, 'days=0 → no task created')

  // days 2 → follow_up
  const c2 = createClient(db, { last_contact_at: daysAgo(2) })
  const t2 = runTaskEngine(db, c2)
  assert(t2?.type === 'follow_up', 'days=2 → follow_up')

  // days 3 → follow_up
  const c3 = createClient(db, { last_contact_at: daysAgo(3) })
  const t3 = runTaskEngine(db, c3)
  assert(t3?.type === 'follow_up', 'days=3 → follow_up')

  // days 4 → call
  const c4 = createClient(db, { last_contact_at: daysAgo(4) })
  const t4 = runTaskEngine(db, c4)
  assert(t4?.type === 'call', 'days=4 → call')

  // days 7 → call
  const c5 = createClient(db, { last_contact_at: daysAgo(7) })
  const t5 = runTaskEngine(db, c5)
  assert(t5?.type === 'call', 'days=7 → call')

  // days 11 → re_engage
  const c6 = createClient(db, { last_contact_at: daysAgo(11) })
  const t6 = runTaskEngine(db, c6)
  assert(t6?.type === 're_engage', 'days=11 → re_engage')

  // days=null (never contacted) → re_engage (999 days)
  const c7 = createClient(db, { last_contact_at: null })
  const t7 = runTaskEngine(db, c7)
  assert(t7?.type === 're_engage', 'days=null (never contacted) → re_engage')
}

section('TASK ENGINE — deduplication')

{
  const db = freshDb()

  const c = createClient(db, { last_contact_at: daysAgo(5) }) // → call
  const t1 = runTaskEngine(db, c)
  assert(t1?.type === 'call', 'first run creates call task')

  const t2 = runTaskEngine(db, c)
  assert(t2 === null, 'second run → no duplicate (returns null)')

  const pendingTasks = db.prepare(`SELECT * FROM tasks WHERE client_id = ? AND status = 'pending'`).all(c)
  assert(pendingTasks.length === 1, 'only 1 pending task in DB (no duplicate)')
}

section('TASK ENGINE — priority scoring')

{
  const db = freshDb()

  // hot client with demand, days=15
  const c_hot = createClient(db, { status: 'hot', last_contact_at: daysAgo(15) })
  createDemand(db, c_hot)
  const t_hot = runTaskEngine(db, c_hot)
  // score: re_engage(+40) + hot(+50) + demand(+30) + min(15,30) = 135
  assert(t_hot?.priority >= 100, `hot+demand+re_engage priority ≥ 100 (got ${t_hot?.priority})`)

  // cold client, no demand, days=5
  const c_cold = createClient(db, { status: 'cold', last_contact_at: daysAgo(5) })
  const t_cold = runTaskEngine(db, c_cold)
  // score: call(0) + cold(0) + no_demand(0) + min(5,30) = 5
  assert(t_cold?.priority < t_hot?.priority, 'cold no-demand < hot with demand')

  // match_call has highest priority base (use distinct city to isolate from c_hot demand)
  const c_match = createClient(db, { status: 'warm', last_contact_at: daysAgo(1) })
  createDemand(db, c_match, { type: 'house', rooms: 4, city: 'Kaunas', budget: 300000 })
  const propId = createProperty(db, { type: 'house', rooms: 4, city: 'Kaunas', price: 250000 })
  const matchTasks = runMatchEngine(db, propId)
  assert(matchTasks.length === 1, 'match engine created task for client with demand')
  assert(matchTasks[0].priority >= 100, `match_call priority ≥ 100 (got ${matchTasks[0].priority})`)
  assert(matchTasks[0].priority > t_cold?.priority, 'match_call > regular call task')
}

section('TASK ENGINE — runTaskEngineForAllClients')

{
  const db = freshDb()

  const c1 = createClient(db, { last_contact_at: daysAgo(3) })  // follow_up
  const c2 = createClient(db, { last_contact_at: daysAgo(5) })  // call
  const c3 = createClient(db, { last_contact_at: daysAgo(0) })  // skip (too soon)

  const tasks = runTaskEngineForAllClients(db)
  assert(tasks.length === 2, 'bulk engine creates 2 tasks (skips days=0 client)')

  const types = tasks.map(t => t.type).sort()
  assert(types.includes('follow_up') && types.includes('call'), 'correct types created')
}

// ─── Match Engine Tests ───────────────────────────────────────────────────────

section('MATCH ENGINE — basic matching')

{
  const db = freshDb()

  // Property with 0 matching demands → 0 tasks
  const propId1 = createProperty(db, { type: 'apartment', rooms: 3, city: 'Kaunas', price: 80000 })
  const noMatches = runMatchEngine(db, propId1)
  assert(noMatches.length === 0, 'property with 0 demands → 0 tasks')

  // 1 client with matching demand → 1 task
  const c1 = createClient(db, { last_contact_at: daysAgo(5) })
  createDemand(db, c1, { type: 'apartment', rooms: 2, city: 'Vilnius', budget: 100000 })

  const propId2 = createProperty(db, { type: 'apartment', rooms: 2, city: 'Vilnius', price: 90000 })
  const matches1 = runMatchEngine(db, propId2)
  assert(matches1.length === 1, '1 matching demand → 1 match_call task')
  assert(matches1[0].type === 'match_call', 'task type is match_call')
  assert(matches1[0].source === 'match_engine', 'task source is match_engine')
}

section('MATCH ENGINE — multiple clients')

{
  const db = freshDb()

  const c1 = createClient(db)
  const c2 = createClient(db)
  const c3 = createClient(db)

  createDemand(db, c1, { type: 'apartment', rooms: 2, city: 'Vilnius', budget: 100000 })
  createDemand(db, c2, { type: 'apartment', rooms: 2, city: 'Vilnius', budget: 95000 })
  createDemand(db, c3, { type: 'apartment', rooms: 2, city: 'Vilnius', budget: 80000 }) // budget too low

  const propId = createProperty(db, { type: 'apartment', rooms: 2, city: 'Vilnius', price: 90000 })
  const tasks = runMatchEngine(db, propId)
  assert(tasks.length === 2, '3 demands, 1 too low budget → 2 match_call tasks')
}

section('MATCH ENGINE — all 4 criteria checked')

{
  const db = freshDb()

  const base = { type: 'apartment', rooms: 2, city: 'Vilnius', budget: 100000 }

  const c_wrong_type = createClient(db)
  createDemand(db, c_wrong_type, { ...base, type: 'house' })

  const c_wrong_rooms = createClient(db)
  createDemand(db, c_wrong_rooms, { ...base, rooms: 3 })

  const c_wrong_city = createClient(db)
  createDemand(db, c_wrong_city, { ...base, city: 'Kaunas' })

  const c_low_budget = createClient(db)
  createDemand(db, c_low_budget, { ...base, budget: 80000 })

  const c_match = createClient(db)
  createDemand(db, c_match, base) // exact match

  const propId = createProperty(db, { type: 'apartment', rooms: 2, city: 'Vilnius', price: 90000 })
  const tasks = runMatchEngine(db, propId)
  assert(tasks.length === 1, 'only exact match fires (type+rooms+city+budget all checked)')
  assert(tasks[0].client_id === c_match, 'correct client matched')
}

section('MATCH ENGINE — no duplicate match_call per client')

{
  const db = freshDb()

  const c = createClient(db)
  createDemand(db, c, { type: 'apartment', rooms: 2, city: 'Vilnius', budget: 100000 })

  const prop1 = createProperty(db, { type: 'apartment', rooms: 2, city: 'Vilnius', price: 90000 })
  const tasks1 = runMatchEngine(db, prop1)
  assert(tasks1.length === 1, 'first property match creates 1 task')

  // Same client, second matching property → no duplicate
  const prop2 = createProperty(db, { type: 'apartment', rooms: 2, city: 'Vilnius', price: 85000 })
  const tasks2 = runMatchEngine(db, prop2)
  assert(tasks2.length === 0, 'second matching property → no duplicate match_call (already pending)')

  const allPending = db.prepare(`SELECT * FROM tasks WHERE client_id = ? AND status = 'pending'`).all(c)
  assert(allPending.length === 1, 'only 1 pending match_call in DB')
}

section('MATCH ENGINE — client with multiple demands')

{
  const db = freshDb()

  const c = createClient(db)
  createDemand(db, c, { type: 'apartment', rooms: 2, city: 'Vilnius', budget: 100000 })
  createDemand(db, c, { type: 'apartment', rooms: 3, city: 'Vilnius', budget: 150000 })

  // Property matches 2nd demand
  const propId = createProperty(db, { type: 'apartment', rooms: 3, city: 'Vilnius', price: 130000 })
  const tasks = runMatchEngine(db, propId)
  assert(tasks.length === 1, 'client with 2 demands matched once (no duplicate)')
}

// ─── Post-Call Engine Tests ───────────────────────────────────────────────────

section('POST-CALL ENGINE — all actions')

{
  const db = freshDb()

  const c1 = createClient(db)
  const t1 = runPostCallEngine(db, c1, 'call_tomorrow')
  assert(t1?.type === 'call', 'call_tomorrow → call task')
  assert(t1?.source === 'post_call', 'source = post_call')

  const c2 = createClient(db)
  const t2 = runPostCallEngine(db, c2, 'follow_up')
  assert(t2?.type === 'follow_up', 'follow_up → follow_up task')

  const c3 = createClient(db)
  const t3 = runPostCallEngine(db, c3, 'schedule_showing')
  assert(t3?.type === 'callback', 'schedule_showing → callback task')

  const c4 = createClient(db)
  const t4 = runPostCallEngine(db, c4, 'none')
  assert(t4 === null, 'none → no task created')
}

section('POST-CALL ENGINE — deduplication')

{
  const db = freshDb()

  const c = createClient(db)
  const t1 = runPostCallEngine(db, c, 'call_tomorrow')
  assert(t1 !== null, 'first call_tomorrow creates task')

  const t2 = runPostCallEngine(db, c, 'call_tomorrow')
  assert(t2 === null, 'second call_tomorrow → no duplicate')
}

// ─── Today Tasks Tests ────────────────────────────────────────────────────────

section('TODAY TASKS — max 7, sorted by priority')

{
  const db = freshDb()

  // Create 10 clients all needing re_engage (days=15)
  for (let i = 0; i < 10; i++) {
    const c = createClient(db, { last_contact_at: daysAgo(15) })
    runTaskEngine(db, c)
  }

  // Add one match_call client
  const cm = createClient(db, { last_contact_at: daysAgo(1) })
  createDemand(db, cm)
  const propId = createProperty(db)
  runMatchEngine(db, propId)

  const tasks = getTodayTasks(db, 7)
  assert(tasks.length === 7, `getTodayTasks returns max 7 (got ${tasks.length})`)
  assert(tasks[0].type === 'match_call', 'match_call is first (highest priority)')

  // Verify sorted descending
  let sorted = true
  for (let i = 0; i < tasks.length - 1; i++) {
    if (tasks[i].priority < tasks[i + 1].priority) { sorted = false; break }
  }
  assert(sorted, 'tasks sorted by priority descending')
}

section('TODAY TASKS — complete task updates last_contact_at')

{
  const db = freshDb()

  const c = createClient(db, { last_contact_at: daysAgo(5) })
  const task = runTaskEngine(db, c)
  assert(task !== null, 'task created')

  const before = db.prepare(`SELECT last_contact_at FROM clients WHERE id = ?`).get(c)

  completeTask(db, task.id)

  const after = db.prepare(`SELECT last_contact_at FROM clients WHERE id = ?`).get(c)
  const taskAfter = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(task.id)

  assert(taskAfter.status === 'done', 'task marked done')
  assert(after.last_contact_at !== before.last_contact_at, 'last_contact_at updated after task done')

  const stillPending = getTodayTasks(db, 7).filter(t => t.id === task.id)
  assert(stillPending.length === 0, 'done task not shown in today tasks')
}

// ─── Full Flow Tests ──────────────────────────────────────────────────────────

section('FULL FLOW — broker morning routine')

{
  const db = freshDb()

  // Setup: 3 clients in different states (all get tasks due today)
  const c_hot  = createClient(db, { status: 'hot',  last_contact_at: daysAgo(12) }) // re_engage (today)
  const c_warm = createClient(db, { status: 'warm', last_contact_at: daysAgo(5)  }) // call (today)
  const c_cold = createClient(db, { status: 'cold', last_contact_at: daysAgo(11) }) // re_engage (today)
  // note: follow_up tasks are due_date=tomorrow by design — not in today tasks

  // Add demand to hot client
  createDemand(db, c_hot)

  runTaskEngineForAllClients(db)

  const tasks = getTodayTasks(db, 7)
  assert(tasks.length === 3, '3 tasks due today for 3 clients')

  // hot+demand+re_engage should be highest
  const hotTask = tasks.find(t => t.client_id === c_hot)
  assert(hotTask !== undefined, 'hot client has task')
  assert(tasks[0].client_id === c_hot, 'hot client re_engage task is first')
}

section('FULL FLOW — property triggers match, broker completes call')

{
  const db = freshDb()

  const c = createClient(db, { status: 'hot', last_contact_at: daysAgo(2) })
  createDemand(db, c, { type: 'house', rooms: 4, city: 'Kaunas', budget: 200000 })

  // Add matching property
  const propId = createProperty(db, { type: 'house', rooms: 4, city: 'Kaunas', price: 185000 })
  const matchTasks = runMatchEngine(db, propId)
  assert(matchTasks.length === 1, 'match_call task created on property insert')

  const today = getTodayTasks(db, 7)
  assert(today[0].type === 'match_call', 'match_call appears first in today tasks')
  assert(today[0].client_id === c, 'correct client in task')

  // Broker completes task
  const result = completeTask(db, today[0].id)
  assert(result !== null, 'completeTask returns task')

  const remaining = getTodayTasks(db, 7)
  assert(remaining.length === 0, 'no tasks remaining after completion')
}

// ─── Results ─────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50))
console.log(`\nRESULTS: ${passed} passed, ${failed} failed\n`)

if (failures.length > 0) {
  console.error('FAILURES:')
  failures.forEach(f => console.error(`  ❌ ${f}`))
  process.exit(1)
} else {
  console.log('All tests passed ✅')
  process.exit(0)
}
