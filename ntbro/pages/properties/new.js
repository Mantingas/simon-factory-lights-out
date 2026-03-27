import { useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '../../components/Layout'

export default function AddProperty() {
  const router = useRouter()
  const [form, setForm] = useState({ type: 'apartment', rooms: '', city: '', price: '' })
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.rooms || !form.city.trim() || !form.price) {
      setError('Visi laukai yra privalomi')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  if (result) {
    const matchCount = result.matchTasks?.length || 0
    return (
      <Layout title="Objektas išsaugotas">
        <div className="text-center py-10">
          <div className="text-5xl mb-4">{matchCount > 0 ? '🎯' : '✅'}</div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            {matchCount > 0 ? `${matchCount} atitikmuo(-ų) rasta!` : 'Objektas išsaugotas'}
          </h2>
          {matchCount > 0 ? (
            <p className="text-slate-600 text-sm mb-6">
              Sukurta {matchCount} „Skambinti — atitikmuo!" užduot{matchCount === 1 ? 'is' : 'ys'}.
              Tikrinkite šiandienos užduotis.
            </p>
          ) : (
            <p className="text-slate-500 text-sm mb-6">Atitinkančių klientų nerasta.</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/')}
              className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-xl"
            >
              Šiandienos užduotys
            </button>
            <button
              onClick={() => { setResult(null); setSaving(false); setForm({ type: 'apartment', rooms: '', city: '', price: '' }) }}
              className="flex-1 bg-white border border-slate-300 text-slate-700 font-medium py-3 rounded-xl"
            >
              + Kitas
            </button>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="Naujas objektas">
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
          <label className="block text-sm font-medium text-slate-700 mb-1">Kaina (€) *</label>
          <input
            type="number"
            value={form.price}
            onChange={e => set('price', e.target.value)}
            placeholder="115000"
            min="0"
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-base disabled:opacity-50"
        >
          {saving ? 'Tikrinama…' : 'Išsaugoti ir tikrinti atitikmenis'}
        </button>
      </form>
    </Layout>
  )
}
