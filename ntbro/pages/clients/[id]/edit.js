import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '../../../components/Layout'

export default function EditClient() {
  const router = useRouter()
  const { id } = router.query
  const [form, setForm] = useState({ name: '', phone: '', status: 'warm', notes: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    fetch(`/api/clients/${id}`)
      .then(r => r.json())
      .then(d => {
        setForm({ name: d.name, phone: d.phone, status: d.status, notes: d.notes || '' })
        setLoading(false)
      })
  }, [id])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Vardas ir telefonas yra privalomi')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/clients/${id}`)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  if (loading) return <Layout title="Redaguoti"><div className="text-center py-16 text-slate-400">Kraunama…</div></Layout>

  return (
    <Layout title="Redaguoti klientą">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vardas *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Telefonas *</label>
          <input
            type="tel"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Statusas</label>
          <div className="flex gap-2">
            {[
              { value: 'hot',  label: '🔴 Karštas' },
              { value: 'warm', label: '🟡 Šiltas' },
              { value: 'cold', label: '🔵 Šaltas' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set('status', opt.value)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  form.status === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Pastabos</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={3}
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-base disabled:opacity-50"
        >
          {saving ? 'Saugoma…' : 'Išsaugoti pakeitimus'}
        </button>
      </form>
    </Layout>
  )
}
