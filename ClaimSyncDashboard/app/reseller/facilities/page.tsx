'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, XCircle, ChevronRight, Download, Activity
} from 'lucide-react'

interface Facility {
  facility_id:      string
  facility_code:    string
  facility_name:    string
  status:           string
  sub_status:       string
  plan_name:        string
  tenant_name:      string
  reseller_name:    string
  trial_until:      string | null
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
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit'
  })
}

export default function ResellerFacilitiesPage() {
  const router = useRouter()
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const getToken = () => typeof window !== 'undefined' ? sessionStorage.getItem('cs_token') : null

  const logout = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('cs_token')
      sessionStorage.removeItem('cs_user')
    }
    router.push('/reseller/login')
  }

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { router.push('/reseller/login'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/claimssync/reseller/facilities', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Dashboard returns facilities array
      setFacilities(Array.isArray(data) ? data : data.items ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-800 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <span className="text-blue-800 font-bold text-sm">CS</span>
          </div>
          <div>
            <span className="font-semibold">ClaimSync</span>
            <span className="text-blue-300 text-xs ml-2">— Reseller Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-4 text-sm">
            <button onClick={() => router.push('/reseller/dashboard')}  className="text-blue-200 hover:text-white transition-colors">Dashboard</button>
            <button onClick={() => router.push('/reseller/facilities')} className="text-white font-medium border-b border-white pb-0.5">Facilities</button>
            <button onClick={() => router.push('/reseller/onboarding')} className="text-blue-200 hover:text-white transition-colors">Requests</button>
            <button onClick={() => router.push('/reseller/onboard')}    className="text-blue-200 hover:text-white transition-colors">+ New Facility</button>
          </nav>
          <button onClick={logout} className="text-xs text-blue-300 hover:text-white">Logout</button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">All Facilities</h1>
            <p className="text-xs text-gray-400 mt-0.5">{facilities.length} facilities under your account</p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
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
        ) : facilities.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No facilities yet</p>
            <button
              onClick={() => router.push('/reseller/onboard')}
              className="mt-4 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + Add New Facility
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {facilities.map(f => (
              <div
                key={f.facility_id}
                onClick={() => router.push(`/reseller/facilities/${f.facility_id}`)}
                className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all p-4 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800">{f.facility_name}</span>
                        <span className="text-xs font-mono text-gray-400">{f.facility_code}</span>
                        <StatusBadge status={f.status} />
                        <StatusBadge status={f.sub_status} />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        <span>{f.plan_name}</span>
                        {f.trial_until && <span>Trial until {new Date(f.trial_until).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                        {f.last_run_at && (
                          <span className="flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            Last sync {fmtDate(f.last_run_at)}
                            {f.last_run_status && <StatusBadge status={f.last_run_status} />}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 ml-4">
                    {f.files_downloaded != null && (
                      <div className="text-right">
                        <div className="text-sm font-bold text-gray-800">{f.files_downloaded}</div>
                        <div className="text-xs text-gray-400">files</div>
                      </div>
                    )}
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
