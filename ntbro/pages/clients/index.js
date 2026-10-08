import { useState, useEffect } from 'react'
import Link from 'next/link'
import Layout from '../../components/Layout'

const STATUS_LABEL = { hot: '🔴 Karštas', warm: '🟡 Šiltas', cold: '🔵 Šaltas' }

export default function ClientsList() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(data => { setClients(data); setLoading(false) })
  }, [])

  return (
    <Layout title="Klientai">
      <div className="flex justify-end mb-4">
        <Link
          href="/clients/new"
          className="bg-blue-600 text-white font-semibold text-sm px-4 py-2 rounded-xl"
        >
          + Pridėti
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">Kraunama…</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500">Nėra klientų.</p>
          <Link href="/clients/new" className="mt-4 inline-block text-blue-600 font-medium text-sm">
            Pridėti pirmą klientą →
          </Link>
        </div>
      ) : (
        clients.map(client => (
          <Link
            key={client.id}
            href={`/clients/${client.id}`}
            className="block bg-white rounded-xl p-4 mb-3 shadow-sm border border-slate-100"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900">{client.name}</p>
                <p className="text-sm text-slate-500">{client.phone}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium">{STATUS_LABEL[client.status]}</p>
                {client.pending_tasks > 0 && (
                  <p className="text-xs text-blue-600 mt-0.5">{client.pending_tasks} užduot.</p>
                )}
              </div>
            </div>
          </Link>
        ))
      )}
    </Layout>
  )
}
