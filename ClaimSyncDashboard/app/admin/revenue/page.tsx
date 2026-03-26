'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  TrendingUp, RefreshCw, Loader2, AlertTriangle,
  DollarSign, Building2, CheckCircle2, Clock, BarChart2, Users
} from 'lucide-react'

// ── Types matching actual API response ─────────────────────────────────────────
interface RevenueSummary {
  active_paid: number
  on_trial:    number
  expired:     number
  mrr_aed:     number
}

interface ResellerRevenue {
  reseller_name:  string
  commission_pct: number
  facilities:     number
  revenue_aed:    number
  commission_aed: number
}

interface PlanSummary {
  plan_type: string
  count:     number
}

interface RevenueData {
  summary:     RevenueSummary
  by_plan:     PlanSummary[]
  by_reseller: ResellerRevenue[]
}

function MetricCard({ icon, label, value, sub, color, bg }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color: string; bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${bg}`}>{icon}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function fmtAED(val: number) {
  if (val === 0) return 'AED 0'
  return `AED ${val.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function AdminRevenuePage() {
  const router = useRouter()
  const [data,    setData]    = useState<RevenueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [user,    setUser]    = useState<any>(null)

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
      const res = await fetch('/api/claimssync/admin/revenue', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status === 401) { logout(); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
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
  const s = data?.summary

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
            <button onClick={() => router.push('/admin/facilities')} className="text-blue-200 hover:text-white transition-colors">Facilities</button>
            <button onClick={() => router.push('/admin/revenue')}    className="text-white font-medium border-b border-white pb-0.5">Revenue</button>
            {isSuperAdmin && <button onClick={() => router.push('/admin/users')} className="text-blue-200 hover:text-white transition-colors">Users</button>}
          </nav>
          <button onClick={logout} className="text-xs text-blue-300 hover:text-white">Logout</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Revenue Overview</h1>
            <p className="text-xs text-gray-400 mt-0.5">Subscription & billing summary</p>
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
            <Loader2 className="w-4 h-4 animate-spin" /> Loading revenue data…
          </div>
        ) : s && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-4 gap-4">
              <MetricCard
                icon={<DollarSign className="w-4 h-4 text-emerald-600" />}
                bg="bg-emerald-50" color="text-emerald-700"
                label="Monthly Recurring Revenue"
                value={fmtAED(s.mrr_aed)}
                sub={`ARR: ${fmtAED(s.mrr_aed * 12)}`}
              />
              <MetricCard
                icon={<CheckCircle2 className="w-4 h-4 text-blue-600" />}
                bg="bg-blue-50" color="text-blue-700"
                label="Active Paid"
                value={String(s.active_paid)}
                sub={`${s.on_trial} on trial`}
              />
              <MetricCard
                icon={<Building2 className="w-4 h-4 text-blue-600" />}
                bg="bg-blue-50" color="text-blue-700"
                label="Total Facilities"
                value={String(s.active_paid + s.on_trial)}
                sub={`${s.expired} expired`}
              />
              <MetricCard
                icon={<Clock className="w-4 h-4 text-amber-600" />}
                bg="bg-amber-50" color="text-amber-700"
                label="On Trial"
                value={String(s.on_trial)}
                sub="Pending conversion"
              />
            </div>

            <div className="grid grid-cols-2 gap-5">
              {/* Plan breakdown */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100">
                  <BarChart2 className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">By Plan</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {(data?.by_plan ?? []).length === 0 ? (
                    <div className="py-6 text-center text-xs text-gray-400">No billing data yet</div>
                  ) : (
                    (data?.by_plan ?? []).map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <span className="text-sm font-medium text-gray-800 uppercase">{p.plan_type}</span>
                        </div>
                        <span className="text-sm font-bold text-blue-600">{p.count} facilities</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Reseller breakdown */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100">
                  <Users className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-semibold text-gray-700">By Reseller</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {(data?.by_reseller ?? []).length === 0 ? (
                    <div className="py-6 text-center text-xs text-gray-400">No reseller data yet</div>
                  ) : (
                    (data?.by_reseller ?? []).map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <div className="text-sm font-medium text-gray-800">{r.reseller_name}</div>
                          <div className="text-xs text-gray-400">
                            {r.facilities} facilities · Commission {r.commission_pct}%
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-emerald-600">{fmtAED(r.revenue_aed)}</div>
                          <div className="text-xs text-gray-400">Commission: {fmtAED(r.commission_aed)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex items-center gap-3">
              <TrendingUp className="w-4 h-4 text-blue-600 shrink-0" />
              <p className="text-xs text-blue-700">
                Both facilities are currently on trial. Revenue will show once paid subscriptions are activated.
                Full billing integration planned for Phase 4.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
