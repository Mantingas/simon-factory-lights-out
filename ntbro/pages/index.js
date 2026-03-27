import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Layout from '../components/Layout'
import TaskCard from '../components/TaskCard'

export default function TodayTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      setTasks(data)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  async function handleDone(taskId) {
    await fetch(`/api/tasks/${taskId}/done`, { method: 'POST' })
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }

  async function handleRefresh() {
    setRefreshing(true)
    await fetch('/api/tasks', { method: 'POST' })
    await fetchTasks()
  }

  const today = new Date().toLocaleDateString('lt-LT', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <Layout title="NTBro">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide">Šiandien</p>
          <p className="text-sm font-medium text-slate-600 capitalize">{today}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-sm text-blue-600 font-medium disabled:opacity-50"
        >
          {refreshing ? 'Atnaujinama…' : '↻ Atnaujinti'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">Kraunama…</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-slate-600 font-medium">Visi darbai atlikti!</p>
          <p className="text-sm text-slate-400 mt-1">Nėra užduočių šiandien.</p>
          <Link
            href="/clients/new"
            className="mt-6 inline-block bg-blue-600 text-white font-semibold px-5 py-2.5 rounded-xl text-sm"
          >
            + Pridėti klientą
          </Link>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-3 uppercase tracking-wide">
            {tasks.length} užduot{tasks.length === 1 ? 'is' : 'ys'}
          </p>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} onDone={handleDone} />
          ))}
        </>
      )}

      <div className="mt-6 flex gap-2">
        <Link
          href="/clients/new"
          className="flex-1 bg-white border border-slate-200 text-slate-700 font-medium text-sm text-center py-3 rounded-xl shadow-sm"
        >
          + Klientas
        </Link>
        <Link
          href="/properties/new"
          className="flex-1 bg-white border border-slate-200 text-slate-700 font-medium text-sm text-center py-3 rounded-xl shadow-sm"
        >
          + Objektas
        </Link>
      </div>
    </Layout>
  )
}
