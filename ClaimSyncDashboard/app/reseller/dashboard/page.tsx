'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, CheckCircle2, Clock, AlertTriangle,
  Plus, RefreshCw, LogOut, Loader2, ChevronRight,
  FileText, Calendar, Activity
} from 'lucide-react'

interface DashboardData {
  facilities: {
    total_facilities: number
    active_facilities: number
    inactive_facilities: number
  }
  last_runs: Array<{
    facility_id: string
    facility_code: string
    facility_name: string
    status: string
    started_at: string
    files_downloaded: number
  }>
  pending_onboarding: number
  expiring_soon: Array<{
    facility_code: string
    facility_name: string
    valid_until: string
    days_remaining: number
  }>
}

function StatCard({ label, value, sub, icon: Icon, color }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className={`text-2xl font-bold mb-0.5 ${color.includes('blue') ? 'text-blue-600' : color.includes('emerald') ? 'text-emerald-600' : color.includes('amber') ? 'text-amber-600' : 'text-gray-700'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-700',
    failed:  'bg-red-100 text-red-700',
    running: 'bg-blue-100 text-blue-700',
    active:  'bg-emerald-100 text-emerald-700',
    inactive:'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function fmtDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export default function ResellerDashboardPage() {
  const router  = useRouter()
  const [data,    setData]    = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [user,    setUser]    = useState<any>(null)

  const getToken = () => sessionStorage.getItem('cs_token')

  const logout = () => {
    sessionStorage.removeItem('cs_token')
    sessionStorage.removeItem('cs_user')
    router.push('/reseller/login')
  }

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { router.push('/reseller/login'); return }

    const u = sessionStorage.getItem('cs_user')
    if (u) setUser(JSON.parse(u))

    setLoading(true)
    try {
      const res = await fetch('/api/claimssync/reseller/dashboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.status === 401) { logout(); return }
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
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
          <span className="text-blue-200 text-sm">👋 {user?.name}</span>
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-blue-700 transition-colors">
            <RefreshCw className="w-4 h-4 text-blue-300" />
          </button>
          <button onClick={logout} className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Partner Dashboard</h1>
            <p className="text-xs text-gray-400">Your ClaimSync client overview</p>
          </div>
          <button
            onClick={() => router.push('/reseller/onboard')}
            className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Client
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Facilities" value={data?.facilities.total_facilities ?? 0}
            icon={Building2} color="bg-blue-50 text-blue-500" />
          <StatCard label="Active" value={data?.facilities.active_facilities ?? 0}
            sub="running daily" icon={CheckCircle2} color="bg-emerald-50 text-emerald-500" />
          <StatCard label="Pending Requests" value={data?.pending_onboarding ?? 0}
            sub="awaiting approval" icon={Clock} color="bg-amber-50 text-amber-500" />
          <StatCard label="Expiring Soon" value={data?.expiring_soon?.length ?? 0}
            sub="within 30 days" icon={AlertTriangle} color="bg-red-50 text-red-500" />
        </div>

        {/* Expiry alerts */}
        {(data?.expiring_soon?.length ?? 0) > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-amber-700">Subscription Renewals Due</span>
            </div>
            <div className="space-y-2">
              {data!.expiring_soon.map(f => (
                <div key={f.facility_code} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700 font-medium">{f.facility_code} — {f.facility_name}</span>
                  <span className={`font-semibold ${f.days_remaining <= 7 ? 'text-red-600' : 'text-amber-600'}`}>
                    {f.days_remaining} days left
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Facility status table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Facility Status</h2>
            <button
              onClick={() => router.push('/reseller/facilities')}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            >
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {data?.last_runs.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8">No facilities yet</div>
            )}
            {data?.last_runs.map(r => (
              <div key={r.facility_id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => router.push(`/reseller/facilities/${r.facility_id}`)}
              >
                <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">{r.facility_code}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">{r.facility_name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-gray-600">{r.files_downloaded} files</div>
                  <div className="text-xs text-gray-400">{fmtDate(r.started_at)}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        {(data?.last_runs?.length ?? 0) > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Activity className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-700">Recent Sync Activity</h2>
            </div>
            <div className="divide-y divide-gray-50">
              <div className="grid grid-cols-4 gap-3 px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide bg-gray-50">
                <div>Facility</div>
                <div>Started</div>
                <div>Status</div>
                <div className="text-right">Files</div>
              </div>
              {data!.last_runs.slice(0, 5).map(r => (
                <div key={r.facility_id}
                  className="grid grid-cols-4 gap-3 px-4 py-2.5 items-center hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/reseller/facilities/${r.facility_id}`)}>
                  <div>
                    <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">{r.facility_code}</span>
                  </div>
                  <div className="text-xs text-gray-500">{fmtDate(r.started_at)}</div>
                  <div><StatusBadge status={r.status} /></div>
                  <div className="text-right text-sm font-semibold text-gray-800">{r.files_downloaded}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'All Facilities', icon: Building2, href: '/reseller/facilities' },
            { label: 'New Onboarding', icon: Plus,      href: '/reseller/onboard' },
            { label: 'View Requests',  icon: FileText,  href: '/reseller/onboarding' },
          ].map(a => (
            <button
              key={a.label}
              onClick={() => router.push(a.href)}
              className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 hover:border-blue-200 transition-colors text-left"
            >
              <a.icon className="w-5 h-5 text-blue-500 shrink-0" />
              <span className="text-sm font-medium text-gray-700">{a.label}</span>
              <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
            </button>
          ))}
        </div>

      </main>
    </div>
  )
}
