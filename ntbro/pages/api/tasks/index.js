import getDb from '../../../lib/db'
import { getTodayTasks, runTaskEngineForAllClients } from '../../../lib/engines'

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'GET') {
    runTaskEngineForAllClients(db)
    const tasks = getTodayTasks(db, 7)
    return res.status(200).json(tasks)
  }

  if (req.method === 'POST') {
    // Trigger daily cron manually
    const created = runTaskEngineForAllClients(db)
    return res.status(200).json({ created })
  }

  res.status(405).end()
}
