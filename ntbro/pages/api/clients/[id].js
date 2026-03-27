import getDb from '../../../lib/db'

export default function handler(req, res) {
  const db = getDb()
  const { id } = req.query

  if (req.method === 'GET') {
    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id)
    if (!client) return res.status(404).json({ error: 'Not found' })

    const demands = db.prepare(`SELECT * FROM demands WHERE client_id = ? ORDER BY created_at DESC`).all(id)
    const interactions = db.prepare(`SELECT * FROM interactions WHERE client_id = ? ORDER BY timestamp DESC LIMIT 20`).all(id)
    const tasks = db.prepare(`SELECT * FROM tasks WHERE client_id = ? AND status = 'pending' ORDER BY priority DESC`).all(id)

    return res.status(200).json({ ...client, demands, interactions, tasks })
  }

  if (req.method === 'PATCH') {
    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id)
    if (!client) return res.status(404).json({ error: 'Not found' })

    const { name, phone, status, notes } = req.body
    db.prepare(`
      UPDATE clients SET
        name   = COALESCE(?, name),
        phone  = COALESCE(?, phone),
        status = COALESCE(?, status),
        notes  = COALESCE(?, notes)
      WHERE id = ?
    `).run(name || null, phone || null, status || null, notes !== undefined ? notes : null, id)

    return res.status(200).json(db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id))
  }

  if (req.method === 'DELETE') {
    db.prepare(`DELETE FROM clients WHERE id = ?`).run(id)
    return res.status(204).end()
  }

  res.status(405).end()
}
