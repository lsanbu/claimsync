export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import StatsCards from '@/components/StatsCards'
import RunTimeline from '@/components/RunTimeline'
import FileBrowser from '@/components/FileBrowser'
import PayerChart  from '@/components/PayerChart'
import { StatsData, RunSummary, FileRecord, PayerStat, Page } from '@/lib/api'

const API   = process.env.CLAIMSSYNC_API_URL!
const KEY   = process.env.CLAIMSSYNC_API_KEY!
const HDRS  = { 'X-API-Key': KEY }

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, { headers: HDRS, next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

export default async function DashboardPage() {
  const [stats, runsPage, filesPage, payers, daily] = await Promise.all([
    fetchJSON<StatsData>('stats/summary?days=30'),
    fetchJSON<{ total: number; items: RunSummary[] }>('runs?limit=10'),
    fetchJSON<Page<FileRecord>>('files?limit=20&offset=0'),
    fetchJSON<PayerStat[]>('stats/payers?days=30'),
    fetchJSON<{ date: string; files_downloaded: number; files_duplicate: number }[]>('stats/daily?days=14'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Sync Dashboard</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Facility MF2618 · Abu Dhabi · Shafafiya API · Auto-refreshes every 60s
        </p>
      </div>
      <section>
        <Suspense fallback={<div className="h-24 bg-gray-100 rounded-xl animate-pulse" />}>
          <StatsCards stats={stats} />
        </Suspense>
      </section>
      <section>
        <h2 className="text-sm font-semibold text-gray-600 mb-3">File Activity</h2>
        <Suspense fallback={<div className="h-56 bg-gray-100 rounded-xl animate-pulse" />}>
          <PayerChart payers={payers} daily={daily} />
        </Suspense>
      </section>
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-600">
            Recent Runs
            <span className="ml-2 text-xs font-normal text-gray-400">({runsPage.total} total)</span>
          </h2>
        </div>
        <Suspense fallback={<div className="h-40 bg-gray-100 rounded-xl animate-pulse" />}>
          <RunTimeline runs={runsPage.items} />
        </Suspense>
      </section>
      <section>
        <h2 className="text-sm font-semibold text-gray-600 mb-3">
          File Manifest
          <span className="ml-2 text-xs font-normal text-gray-400">({filesPage.total} files)</span>
        </h2>
        <Suspense fallback={<div className="h-40 bg-gray-100 rounded-xl animate-pulse" />}>
          <FileBrowser initialData={filesPage} />
        </Suspense>
      </section>
    </div>
  )
}