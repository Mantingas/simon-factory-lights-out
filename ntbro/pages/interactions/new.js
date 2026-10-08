import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '../../components/Layout'

const POST_CALL_OPTIONS = [
  { value: 'call_tomorrow',    label: '📞 Skambinti rytoj' },
  { value: 'follow_up',        label: '📩 Sekti (+2 d.)' },
  { value: 'schedule_showing', label: '🏠 Planavimas' },
  { value: 'none',             label: '⏭ Nieko' },
]

export default function LogInteraction() {
  const router = useRouter()
  const { client_id } = router.query

  const [clientName, setClientName] = useState('')
  const [form, setForm] = useState({ type: 'call', notes: '', post_call_action: 'none' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!client_id) return
    fetch(`/api/clients/${client_id}`)
      .then(r => r.json())
      .then(d => { if (d.name) setClientName(d.name) })
  }, [client_id])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    setSaving(true)
    try {
      const res = await fetch('/api/interactions', {
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
    <Layout title={clientName ? `Ryšys: ${clientName}` : 'Įrašyti ryšį'}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Ryšio tipas</label>
          <div className="flex gap-2">
            {[
              { value: 'call',    label: '📞 Skambutis' },
              { value: 'sms',     label: '💬 SMS' },
              { value: 'meeting', label: '🤝 Susitikimas' },
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
          <label className="block text-sm font-medium text-slate-700 mb-1">Pastabos (neprivaloma)</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Ko klientas nori, ką sakė…"
            rows={3}
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Kitas veiksmas</label>
          <div className="space-y-2">
            {POST_CALL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set('post_call_action', opt.value)}
                className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium border transition-colors ${
                  form.post_call_action === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={saving || !client_id}
          className="w-full bg-green-600 text-white font-semibold py-3.5 rounded-xl text-base disabled:opacity-50"
        >
          {saving ? 'Saugoma…' : 'Išsaugoti ryšį'}
        </button>
      </form>
    </Layout>
  )
}
