import { v4 as uuidv4 } from 'uuid'
import getDb from '../../../lib/db'
import { runMatchEngine } from '../../../lib/engines'

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'GET') {
    const properties = db.prepare(`SELECT * FROM properties ORDER BY created_at DESC`).all()
    return res.status(200).json(properties)
  }

  if (req.method === 'POST') {
    const { type, rooms, city, price } = req.body
    if (!type || !rooms || !city || !price) {
      return res.status(400).json({ error: 'type, rooms, city, price are required' })
    }

    const id = uuidv4()
    db.prepare(`
      INSERT INTO properties (id, type, rooms, city, price)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, type, parseInt(rooms), city.trim(), parseFloat(price))

    const matchTasks = runMatchEngine(db, id)

    const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(id)
    return res.status(201).json({ property, matchTasks })
  }

  res.status(405).end()
}
