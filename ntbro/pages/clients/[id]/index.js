import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Layout from '../../../components/Layout'

const STATUS_LABEL = { hot: '🔴 Karštas', warm: '🟡 Šiltas', cold: '🔵 Šaltas' }
const INTERACTION_LABEL = { call: '📞 Skambutis', sms: '💬 SMS', meeting: '🤝 Susitikimas' }
const TASK_LABEL = {
  match_call: '🔥 Atitikmuo — skambinti!',
  re_engage:  '🔄 Atnaujinti ryšį',
  call:       '📞 Skambinti',
  follow_up:  '📩 Sekti',
  callback:   '🏠 Rodymas',
}

function formatDate(str) {
  if (!str) return '–'
  return new Date(str).toLocaleDateString('lt-LT', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ClientDetail() {
  const router = useRouter()
  const { id } = router.query
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    fetch(`/api/clients/${id}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
  }, [id])

  if (loading) return <Layout title="Klientas"><div className="text-center py-16 text-slate-400">Kraunama…</div></Layout>
  if (!data || data.error) return <Layout title="Klientas"><div className="text-center py-16 text-slate-400">Nerastas</div></Layout>

  return (
    <Layout title={data.name}>
      {/* Client info */}
      <div className="bg-white rounded-xl p-4 mb-4 shadow-sm border border-slate-100">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-bold text-lg text-slate-900">{data.name}</p>
            <a href={`tel:${data.phone}`} className="text-blue-600 font-medium">{data.phone}</a>
            <p className="text-xs text-slate-500 mt-1">{STATUS_LABEL[data.status]}</p>
          </div>
          <a
            href={`tel:${data.phone}`}
            className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-xl text-sm"
          >
            Skambinti
          </a>
        </div>
        {data.notes && <p className="text-sm text-slate-600 mt-3 pt-3 border-t border-slate-100">{data.notes}</p>}
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-slate-400">
            Paskutinis kontaktas: {formatDate(data.last_contact_at)}
          </p>
          <Link href={`/clients/${id}/edit`} className="text-xs text-blue-500 font-medium">
            Redaguoti
          </Link>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 mb-4">
        <Link
          href={`/interactions/new?client_id=${id}`}
          className="flex-1 bg-green-600 text-white font-semibold text-sm text-center py-3 rounded-xl"
        >
          + Ryšys
        </Link>
        <Link
          href={`/demands/new?client_id=${id}`}
          className="flex-1 bg-white border border-slate-200 text-slate-700 font-medium text-sm text-center py-3 rounded-xl"
        >
          + Poreikis
        </Link>
      </div>

      {/* Pending tasks */}
      {data.tasks.length > 0 && (
        <section className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Užduotys</p>
          {data.tasks.map(t => (
            <div key={t.id} className="bg-orange-50 border-l-4 border-l-orange-400 rounded-xl p-3 mb-2 text-sm font-medium text-slate-800">
              {TASK_LABEL[t.type] || t.type}
              <span className="text-xs text-slate-400 ml-2">iki {formatDate(t.due_date)}</span>
            </div>
          ))}
        </section>
      )}

      {/* Demands */}
      <section className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Poreikiai</p>
        {data.demands.length === 0 ? (
          <p className="text-sm text-slate-400">Nėra poreikių.</p>
        ) : (
          data.demands.map(d => (
            <div key={d.id} className="bg-white rounded-xl p-3 mb-2 border border-slate-100 shadow-sm text-sm">
              <p className="font-medium text-slate-800">
                {d.type === 'apartment' ? 'Butas' : 'Namas'} · {d.rooms} k. · {d.city}
              </p>
              <p className="text-slate-500">Biudžetas: {d.budget.toLocaleString('lt-LT')} €</p>
            </div>
          ))
        )}
      </section>

      {/* Interaction history */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Istorija</p>
        {data.interactions.length === 0 ? (
          <p className="text-sm text-slate-400">Nėra ryšių.</p>
        ) : (
          data.interactions.map(i => (
            <div key={i.id} className="flex gap-3 items-start mb-3">
              <span className="text-lg shrink-0">{INTERACTION_LABEL[i.type]?.split(' ')[0]}</span>
              <div>
                <p className="text-sm font-medium text-slate-800">{INTERACTION_LABEL[i.type] || i.type}</p>
                <p className="text-xs text-slate-400">{formatDate(i.timestamp)}</p>
                {i.notes && <p className="text-sm text-slate-600 mt-0.5">{i.notes}</p>}
              </div>
            </div>
          ))
        )}
      </section>
    </Layout>
  )
}
