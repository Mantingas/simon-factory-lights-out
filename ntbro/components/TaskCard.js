const TASK_LABELS = {
  match_call: 'ATITIKMUO — SKAMBINTI!',
  re_engage:  'Atnaujinti ryšį',
  call:       'Skambinti',
  follow_up:  'Sekti',
  callback:   'Planavimas',
}

const PRIORITY_COLOR = (priority) => {
  if (priority >= 80) return 'border-l-red-500 bg-red-50'
  if (priority >= 50) return 'border-l-orange-400 bg-orange-50'
  return 'border-l-yellow-400 bg-yellow-50'
}

const PRIORITY_DOT = (priority) => {
  if (priority >= 80) return '🔴'
  if (priority >= 50) return '🟠'
  return '🟡'
}

export default function TaskCard({ task, onDone }) {
  const label = TASK_LABELS[task.type] || task.type
  const colors = PRIORITY_COLOR(task.priority)

  return (
    <div className={`rounded-xl border-l-4 p-4 mb-3 shadow-sm ${colors}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span>{PRIORITY_DOT(task.priority)}</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </span>
          </div>
          <p className="text-base font-semibold text-slate-900 truncate">
            {task.client_name}
          </p>
          <p className="text-sm text-slate-500 mt-0.5">{task.client_phone}</p>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <a
            href={`tel:${task.client_phone}`}
            className="bg-blue-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg text-center"
          >
            Skambinti
          </a>
          <button
            onClick={() => onDone(task.id)}
            className="bg-white border border-slate-300 text-slate-700 text-sm font-medium px-3 py-1.5 rounded-lg"
          >
            Atlikta
          </button>
        </div>
      </div>
    </div>
  )
}
