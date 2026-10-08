import { v4 as uuidv4 } from 'uuid'
import getDb from '../../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'POST') {
    const { client_id, type, rooms, city, budget } = req.body
    if (!client_id || !type || !rooms || !city || !budget) {
      return res.status(400).json({ error: 'client_id, type, rooms, city, budget are required' })
    }

    const client = db.prepare(`SELECT id FROM clients WHERE id = ?`).get(client_id)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    const id = uuidv4()
    db.prepare(`
      INSERT INTO demands (id, client_id, type, rooms, city, budget)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, client_id, type, parseInt(rooms), city.trim(), parseFloat(budget))

    return res.status(201).json(db.prepare(`SELECT * FROM demands WHERE id = ?`).get(id))
  }

  res.status(405).end()
}
