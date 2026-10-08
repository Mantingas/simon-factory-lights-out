import { v4 as uuidv4 } from 'uuid'
import getDb from '../../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'GET') {
    const clients = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM demands d WHERE d.client_id = c.id) as demand_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.status = 'pending') as pending_tasks
      FROM clients c
      ORDER BY c.created_at DESC
    `).all()
    return res.status(200).json(clients)
  }

  if (req.method === 'POST') {
    const { name, phone, status = 'warm', notes } = req.body
    if (!name || !phone) {
      return res.status(400).json({ error: 'name and phone are required' })
    }

    const id = uuidv4()
    db.prepare(`
      INSERT INTO clients (id, name, phone, status, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name.trim(), phone.trim(), status, notes || null)

    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id)
    return res.status(201).json(client)
  }

  res.status(405).end()
}
