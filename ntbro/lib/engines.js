import { v4 as uuidv4 } from 'uuid'
import getDb from './db.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return 999
  const then = new Date(dateStr)
  const now = new Date()
  return Math.floor((now - then) / (1000 * 60 * 60 * 24))
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function futureDateISO(daysFromNow) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

function hasPendingTaskOfType(db, clientId, type) {
  const row = db.prepare(
    `SELECT id FROM tasks WHERE client_id = ? AND type = ? AND status = 'pending' LIMIT 1`
  ).get(clientId, type)
  return !!row
}

function hasActiveDemand(db, clientId) {
  const row = db.prepare(
    `SELECT id FROM demands WHERE client_id = ? LIMIT 1`
  ).get(clientId)
  return !!row
}

// ─── Priority Scoring ─────────────────────────────────────────────────────────

function computePriority(db, clientId, taskType, daysSinceContact) {
  const client = db.prepare(`SELECT status FROM clients WHERE id = ?`).get(clientId)
  let score = 0

  if (client?.status === 'hot')        score += 50
  if (hasActiveDemand(db, clientId))   score += 30
  if (taskType === 'match_call')       score += 70
  if (taskType === 're_engage')        score += 40
  if (taskType === 'follow_up')        score += 20

  score += Math.min(daysSinceContact, 30)

  return score
}

// ─── Task Engine ──────────────────────────────────────────────────────────────

export function runTaskEngine(db, clientId) {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId)
  if (!client) return null

  const days = daysSince(client.last_contact_at)

  let taskType = null
  let daysOffset = 1

  if (days < 1)       return null
  if (days >= 2 && days <= 3)  { taskType = 'follow_up'; daysOffset = 1 }
  else if (days >= 4 && days <= 7) { taskType = 'call';  daysOffset = 0 }
  else if (days > 10)           { taskType = 're_engage'; daysOffset = 0 }

  if (!taskType) return null

  if (hasPendingTaskOfType(db, clientId, taskType)) return null

  const priority = computePriority(db, clientId, taskType, days)
  const dueDate = daysOffset === 0 ? todayISO() : futureDateISO(daysOffset)

  const task = {
    id: uuidv4(),
    client_id: clientId,
    type: taskType,
    priority,
    due_date: dueDate,
    status: 'pending',
    source: 'system',
  }

  db.prepare(`
    INSERT OR IGNORE INTO tasks (id, client_id, type, priority, due_date, status, source)
    VALUES (@id, @client_id, @type, @priority, @due_date, @status, @source)
  `).run(task)

  return task
}

export function runTaskEngineForAllClients(db) {
  const clients = db.prepare(`SELECT id FROM clients`).all()
  const created = []
  for (const { id } of clients) {
    const task = runTaskEngine(db, id)
    if (task) created.push(task)
  }
  return created
}

// ─── Match Engine ─────────────────────────────────────────────────────────────

export function runMatchEngine(db, propertyId) {
  const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(propertyId)
  if (!property) return []

  const matchingDemands = db.prepare(`
    SELECT * FROM demands
    WHERE type  = ?
      AND rooms = ?
      AND city  = ?
      AND budget >= ?
  `).all(property.type, property.rooms, property.city, property.price)

  const created = []

  for (const demand of matchingDemands) {
    if (hasPendingTaskOfType(db, demand.client_id, 'match_call')) continue

    const days = daysSince(
      db.prepare(`SELECT last_contact_at FROM clients WHERE id = ?`).get(demand.client_id)?.last_contact_at
    )
    const priority = computePriority(db, demand.client_id, 'match_call', days)

    const task = {
      id: uuidv4(),
      client_id: demand.client_id,
      type: 'match_call',
      priority,
      due_date: todayISO(),
      status: 'pending',
      source: 'match_engine',
    }

    db.prepare(`
      INSERT OR IGNORE INTO tasks (id, client_id, type, priority, due_date, status, source)
      VALUES (@id, @client_id, @type, @priority, @due_date, @status, @source)
    `).run(task)

    created.push(task)
  }

  return created
}

// ─── Post-Call Engine ─────────────────────────────────────────────────────────

export function runPostCallEngine(db, clientId, action) {
  if (action === 'none' || !action) return null

  const typeMap = {
    call_tomorrow:     { type: 'call',      days: 1 },
    follow_up:         { type: 'follow_up', days: 2 },
    schedule_showing:  { type: 'callback',  days: 1 },
  }

  const mapping = typeMap[action]
  if (!mapping) return null

  if (hasPendingTaskOfType(db, clientId, mapping.type)) return null

  const days = daysSince(
    db.prepare(`SELECT last_contact_at FROM clients WHERE id = ?`).get(clientId)?.last_contact_at
  )
  const priority = computePriority(db, clientId, mapping.type, days)

  const task = {
    id: uuidv4(),
    client_id: clientId,
    type: mapping.type,
    priority,
    due_date: futureDateISO(mapping.days),
    status: 'pending',
    source: 'post_call',
  }

  db.prepare(`
    INSERT OR IGNORE INTO tasks (id, client_id, type, priority, due_date, status, source)
    VALUES (@id, @client_id, @type, @priority, @due_date, @status, @source)
  `).run(task)

  return task
}

// ─── Get Today Tasks ──────────────────────────────────────────────────────────

export function getTodayTasks(db, limit = 7) {
  const today = todayISO()
  return db.prepare(`
    SELECT t.*, c.name as client_name, c.phone as client_phone, c.status as client_status
    FROM tasks t
    JOIN clients c ON c.id = t.client_id
    WHERE t.status = 'pending'
      AND t.due_date <= ?
    ORDER BY t.priority DESC
    LIMIT ?
  `).all(today, limit)
}

// ─── Mark Task Done ───────────────────────────────────────────────────────────

export function completeTask(db, taskId) {
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId)
  if (!task) return null

  db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(taskId)

  db.prepare(`
    UPDATE clients SET last_contact_at = datetime('now') WHERE id = ?
  `).run(task.client_id)

  return task
}
