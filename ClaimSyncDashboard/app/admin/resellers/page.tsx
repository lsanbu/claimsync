'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Building2, RefreshCw, Loader2, AlertTriangle,
  TrendingUp, Mail
} from 'lucide-react'

interface Reseller {
  reseller_id:     string
  name:            string
  short_code:      string
  contact_name:    string
  contact_email:   string
  login_email:     string
  emirate:         string | null
  level:           string
  commission_pct:  number
  status:          string
  facility_count:  number
  tenant_count:    number
  last_login_at:   string | null
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:    'bg-emerald-100 text-emerald-700',
    inactive:  'bg-gray-100 text-gray-500',
    suspended: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function LevelBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    master:     'bg-purple-100 text-purple-700',
    sub:        'bg-blue-100 text-blue-700',
    individual: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[level] || 'bg-gray-100 text-gray-600'}`}>
      {level}
    </span>
  )
}

export default function AdminResellersPage() {
  const router = useRouter()
  const [resellers, setResellers] = useState<Reseller[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [user,      setUser]      = useState<any>(null)
  const [search,    setSearch]    = useState('')

  const getToken = () => typeof window !== 'undefined' ? sessionStorage.getItem('cs_admin_token') : null

  const logout = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('cs_admin_token')
      sessionStorage.removeItem('cs_admin_user')
    }
    router.push('/admin/login')
  }

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { router.push('/admin/login'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/claimssync/admin/resellers', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResellers(Array.isArray(data) ? data : data.items ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const u = typeof window !== 'undefined' ? sessionStorage.getItem('cs_admin_user') : null
    if (u) setUser(JSON.parse(u))
    load()
  }, [load])

  const isSuperAdmin = user?.is_super_admin === true

  const filtered = resellers.filter(r =>
    search === '' ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.login_email.toLowerCase().includes(search.toLowerCase()) ||
    r.short_code.toLowerCase().includes(search.toLowerCase())
  )

  const totalFacilities = resellers.reduce((s, r) => s + (r.facility_count ?? 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <span className="text-blue-900 font-bold text-sm">CS</span>
          </div>
          <div>
            <span className="font-semibold">ClaimSync</span>
            <span className="text-blue-300 text-xs ml-2">— Admin Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <nav className="flex items-center gap-4 text-sm">
            <button onClick={() => router.push('/admin/dashboard')}  className="text-blue-200 hover:text-white transition-colors">Dashboard</button>
            <button onClick={() => router.push('/admin/onboarding')} className="text-blue-200 hover:text-white transition-colors">Onboarding</button>
            <button onClick={() => router.push('/admin/resellers')}  className="text-white font-medium border-b border-white pb-0.5">Resellers</button>
            <button onClick={() => router.push('/admin/facilities')} className="text-blue-200 hover:text-white transition-colors">Facilities</button>
            <button onClick={() => router.push('/admin/revenue')}    className="text-blue-200 hover:text-white transition-colors">Revenue</button>
            {isSuperAdmin && <button onClick={() => router.push('/admin/users')} className="text-blue-200 hover:text-white transition-colors">Users</button>}
          </nav>
          <button onClick={logout} className="text-xs text-blue-300 hover:text-white">Logout</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Resellers</h1>
            <p className="text-xs text-gray-400 mt-0.5">All registered resellers — {resellers.length} total</p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {!loading && resellers.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Resellers',  value: resellers.length,  color: 'text-blue-600',    bg: 'bg-blue-50',    icon: <Users className="w-4 h-4 text-blue-600" /> },
              { label: 'Total Facilities', value: totalFacilities,   color: 'text-emerald-600', bg: 'bg-emerald-50', icon: <Building2 className="w-4 h-4 text-emerald-600" /> },
              { label: 'Active Resellers', value: resellers.filter(r => r.status === 'active').length, color: 'text-purple-600', bg: 'bg-purple-50', icon: <TrendingUp className="w-4 h-4 text-purple-600" /> },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.bg}`}>{s.icon}</div>
                <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <input
          type="text"
          placeholder="Search by name, email or code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
        />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading resellers…
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-6 gap-4 px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
              <div className="col-span-2">Reseller</div>
              <div>Level</div>
              <div className="text-right">Facilities</div>
              <div className="text-right">Commission</div>
              <div className="text-right">Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No resellers found</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <div key={r.reseller_id} className="grid grid-cols-6 gap-4 px-5 py-3.5 items-center hover:bg-gray-50 transition-colors">
                    <div className="col-span-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                          <span className="text-blue-700 font-bold text-xs">{r.short_code?.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-800">{r.name}</div>
                          <div className="flex items-center gap-1 text-xs text-gray-400">
                            <Mail className="w-3 h-3" /> {r.login_email}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div><LevelBadge level={r.level} /></div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-gray-800">{r.facility_count ?? 0}</span>
                    </div>
                    <div className="text-right text-sm text-gray-700">{r.commission_pct}%</div>
                    <div className="text-right"><StatusBadge status={r.status} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
