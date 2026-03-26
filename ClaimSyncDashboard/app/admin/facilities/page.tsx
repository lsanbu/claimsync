'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, XCircle, Search, Download, Activity, ChevronDown, ChevronUp, Play
} from 'lucide-react'
import ResendCredentialToken from '@/components/admin/ResendCredentialToken'

// ── Types matching actual API response ─────────────────────────────────────────
interface Facility {
  facility_id:      string
  facility_code:    string
  facility_name:    string
  status:           string   // active / inactive
  sub_status:       string   // trial / active / expired
  plan_name:        string
  tenant_name:      string
  tenant_code:      string
  reseller_name:    string
  blob_container:   string
  trial_until:      string | null
  valid_until:      string | null
  last_run_at:      string | null
  last_run_status:  string | null
  files_downloaded: number | null
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:   'bg-emerald-100 text-emerald-700',
    inactive: 'bg-gray-100 text-gray-500',
    trial:    'bg-amber-100 text-amber-700',
    success:  'bg-emerald-100 text-emerald-700',
    failed:   'bg-red-100 text-red-700',
    expired:  'bg-red-100 text-red-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function fmtDateTime(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit'
  })
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function AdminFacilitiesPage() {
  const router = useRouter()
  const [facilities,    setFacilities]    = useState<Facility[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [user,          setUser]          = useState<any>(null)
  const [search,        setSearch]        = useState('')
  const [filterStatus,  setFilterStatus]  = useState<string>('all')
  const [expandedId,    setExpandedId]    = useState<string | null>(null)

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
      const res = await fetch('/api/claimssync/admin/facilities', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setFacilities(Array.isArray(data) ? data : data.items ?? [])
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

  const filtered = facilities.filter(f => {
    const matchesSearch = search === '' ||
      f.facility_name.toLowerCase().includes(search.toLowerCase()) ||
      f.facility_code.toLowerCase().includes(search.toLowerCase()) ||
      f.reseller_name.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = filterStatus === 'all' || f.status === filterStatus || f.sub_status === filterStatus
    return matchesSearch && matchesStatus
  })

  const activeCount    = facilities.filter(f => f.status === 'active').length
  const totalFiles     = facilities.reduce((s, f) => s + (f.files_downloaded ?? 0), 0)
  const trialCount     = facilities.filter(f => f.sub_status === 'trial').length

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
            <button onClick={() => router.push('/admin/resellers')}  className="text-blue-200 hover:text-white transition-colors">Resellers</button>
            <button onClick={() => router.push('/admin/facilities')} className="text-white font-medium border-b border-white pb-0.5">Facilities</button>
            <button onClick={() => router.push('/admin/revenue')}    className="text-blue-200 hover:text-white transition-colors">Revenue</button>
            {isSuperAdmin && <button onClick={() => router.push('/admin/users')} className="text-blue-200 hover:text-white transition-colors">Users</button>}
          </nav>
          <button onClick={logout} className="text-xs text-blue-300 hover:text-white">Logout</button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">All Facilities</h1>
            <p className="text-xs text-gray-400 mt-0.5">Platform-wide — {facilities.length} total across all resellers</p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {!loading && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total',         value: facilities.length, color: 'text-blue-600',    bg: 'bg-blue-50',    icon: <Building2 className="w-4 h-4 text-blue-600" /> },
              { label: 'Active',        value: activeCount,       color: 'text-emerald-600', bg: 'bg-emerald-50', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" /> },
              { label: 'On Trial',      value: trialCount,        color: 'text-amber-600',   bg: 'bg-amber-50',   icon: <Activity className="w-4 h-4 text-amber-600" /> },
              { label: 'Files Synced',  value: totalFiles.toLocaleString(), color: 'text-blue-600', bg: 'bg-blue-50', icon: <Download className="w-4 h-4 text-blue-600" /> },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.bg}`}>{s.icon}</div>
                <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search facility, code, reseller…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            />
          </div>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="trial">Trial</option>
          </select>
          <span className="text-xs text-gray-400">{filtered.length} shown</span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading facilities…
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-7 gap-3 px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
              <div className="col-span-2">Facility</div>
              <div>Reseller</div>
              <div>Plan</div>
              <div>Sub Status</div>
              <div>Last Sync</div>
              <div>Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No facilities match</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filtered.map(f => (
                  <div key={f.facility_id}>
                    <div
                      onClick={() => setExpandedId(expandedId === f.facility_id ? null : f.facility_id)}
                      className="grid grid-cols-7 gap-3 px-5 py-3.5 items-center hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <div className="col-span-2 flex items-center gap-2">
                        <div className="shrink-0">
                          {expandedId === f.facility_id
                            ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                            : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                          }
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-800">{f.facility_name}</div>
                          <div className="text-xs text-gray-400 font-mono">{f.facility_code}</div>
                          <div className="text-xs text-gray-400">{f.tenant_name}</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-600">{f.reseller_name}</div>
                      <div className="text-xs font-medium text-blue-600">{f.plan_name}</div>
                      <div>
                        <StatusBadge status={f.sub_status} />
                        {f.trial_until && (
                          <div className="text-xs text-gray-400 mt-0.5">Until {fmtDate(f.trial_until)}</div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {fmtDateTime(f.last_run_at)}
                        {f.last_run_status && (
                          <div className="mt-0.5">
                            <StatusBadge status={f.last_run_status} />
                          </div>
                        )}
                      </div>
                      <div><StatusBadge status={f.status} /></div>
                    </div>
                    {expandedId === f.facility_id && (
                      <div className="px-5 pb-4 pt-1 bg-gray-50 border-t border-gray-100 space-y-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); router.push(`/admin/facilities/${f.facility_code}/adhoc-run`) }}
                          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5 bg-white hover:bg-blue-50 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" /> Adhoc Run
                        </button>
                        <ResendCredentialToken
                          facilityId={f.facility_id}
                          facilityCode={f.facility_code}
                          currentEmail={null}
                        />
                      </div>
                    )}
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
