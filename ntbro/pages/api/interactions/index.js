import { v4 as uuidv4 } from 'uuid'
import getDb from '../../../lib/db'
import { runTaskEngine, runPostCallEngine } from '../../../lib/engines'

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'POST') {
    const { client_id, type, notes, post_call_action } = req.body
    if (!client_id || !type) {
      return res.status(400).json({ error: 'client_id and type are required' })
    }

    const client = db.prepare(`SELECT id FROM clients WHERE id = ?`).get(client_id)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    const id = uuidv4()
    const timestamp = new Date().toISOString()

    db.prepare(`
      INSERT INTO interactions (id, client_id, type, timestamp, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, client_id, type, timestamp, notes || null)

    db.prepare(`
      UPDATE clients SET last_contact_at = ? WHERE id = ?
    `).run(timestamp, client_id)

    let task = null
    if (post_call_action && post_call_action !== 'none') {
      task = runPostCallEngine(db, client_id, post_call_action)
    } else {
      task = runTaskEngine(db, client_id)
    }

    const interaction = db.prepare(`SELECT * FROM interactions WHERE id = ?`).get(id)
    return res.status(201).json({ interaction, task })
  }

  res.status(405).end()
}
