import getDb from '../../../../lib/db'
import { completeTask } from '../../../../lib/engines'

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const db = getDb()
  const { id } = req.query

  const task = completeTask(db, id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  return res.status(200).json({ ok: true, task })
}
