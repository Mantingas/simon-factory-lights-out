import Link from 'next/link'
import { useRouter } from 'next/router'

export default function Layout({ children, title }) {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="flex items-center h-14 px-4 gap-3">
          {router.pathname !== '/' && (
            <button
              onClick={() => router.back()}
              className="text-slate-500 text-lg font-medium pr-2"
            >
              ←
            </button>
          )}
          <h1 className="text-base font-semibold text-slate-900 flex-1">
            {title || 'NTBro'}
          </h1>
        </div>
      </header>

      <main className="flex-1 px-4 py-4">
        {children}
      </main>

      {router.pathname === '/' && (
        <nav className="bg-white border-t border-slate-200 flex">
          <Link href="/" className="flex-1 flex flex-col items-center py-3 text-xs font-medium text-blue-600">
            <span className="text-xl mb-0.5">📋</span>
            Užduotys
          </Link>
          <Link href="/clients" className="flex-1 flex flex-col items-center py-3 text-xs font-medium text-slate-500">
            <span className="text-xl mb-0.5">👥</span>
            Klientai
          </Link>
          <Link href="/properties/new" className="flex-1 flex flex-col items-center py-3 text-xs font-medium text-slate-500">
            <span className="text-xl mb-0.5">🏠</span>
            Objektas
          </Link>
        </nav>
      )}
    </div>
  )
}
