'use client'
import { StatsData, fmtDuration, fmtDate, statusColor } from '@/lib/api'
import { Activity, Download, Clock, TrendingUp } from 'lucide-react'

interface Props { stats: StatsData }

export default function StatsCards({ stats }: Props) {
  const successRate = stats.total_runs > 0
    ? Math.round((stats.successful_runs / stats.total_runs) * 100)
    : 0

  const cards = [
    {
      label: 'Total Runs',
      value: stats.total_runs,
      sub: `${stats.successful_runs} success · ${stats.failed_runs} failed`,
      icon: Activity,
      color: 'text-brand-600',
      bg: 'bg-brand-50',
    },
    {
      label: 'Files Downloaded',
      value: stats.total_files_downloaded,
      sub: `${stats.total_files_duplicate} resubmissions`,
      icon: Download,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Avg Duration',
      value: fmtDuration(stats.avg_duration_seconds),
      sub: 'per BAU run',
      icon: Clock,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: 'Success Rate',
      value: `${successRate}%`,
      sub: stats.last_run_at ? `Last run ${fmtDate(stats.last_run_at)}` : 'No runs yet',
      icon: TrendingUp,
      color: successRate >= 80 ? 'text-emerald-600' : 'text-amber-600',
      bg: successRate >= 80 ? 'bg-emerald-50' : 'bg-amber-50',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{c.label}</span>
            <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center`}>
              <c.icon className={`w-4 h-4 ${c.color}`} />
            </div>
          </div>
          <div className={`text-2xl font-bold ${c.color} mb-1`}>{c.value}</div>
          <div className="text-xs text-gray-400">{c.sub}</div>
        </div>
      ))}

      {/* Last run status banner */}
      {stats.last_run_status && (
        <div className={`col-span-2 lg:col-span-4 rounded-lg border px-4 py-2 flex items-center gap-2 text-sm ${statusColor(stats.last_run_status)}`}>
          <span className="font-medium capitalize">Last run: {stats.last_run_status}</span>
          {stats.last_run_at && <span className="text-xs opacity-75">· {fmtDate(stats.last_run_at)}</span>}
        </div>
      )}
    </div>
  )
}
