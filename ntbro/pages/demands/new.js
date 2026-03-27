import { useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '../../components/Layout'

export default function AddDemand() {
  const router = useRouter()
  const { client_id } = router.query

  const [form, setForm] = useState({ type: 'apartment', rooms: '', city: '', budget: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.rooms || !form.city.trim() || !form.budget) {
      setError('Visi laukai yra privalomi')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/demands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, client_id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/clients/${client_id}`)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <Layout title="Naujas poreikis">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Tipas</label>
          <div className="flex gap-2">
            {[
              { value: 'apartment', label: '🏢 Butas' },
              { value: 'house',     label: '🏡 Namas' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set('type', opt.value)}
                className={`flex-1 py-3 rounded-xl text-sm font-medium border transition-colors ${
                  form.type === opt.value
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
          <label className="block text-sm font-medium text-slate-700 mb-1">Kambarių skaičius *</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => set('rooms', n)}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors ${
                  form.rooms === n
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Miestas *</label>
          <input
            type="text"
            value={form.city}
            onChange={e => set('city', e.target.value)}
            placeholder="Vilnius"
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Biudžetas (€) *</label>
          <input
            type="number"
            value={form.budget}
            onChange={e => set('budget', e.target.value)}
            placeholder="120000"
            min="0"
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={saving || !client_id}
          className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-base disabled:opacity-50"
        >
          {saving ? 'Saugoma…' : 'Išsaugoti poreikį'}
        </button>
      </form>
    </Layout>
  )
}
