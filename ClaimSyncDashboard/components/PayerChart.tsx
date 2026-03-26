'use client'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, Legend, LabelList
} from 'recharts'
import { PayerStat } from '@/lib/api'

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4']

interface DailyPoint { date: string; files_downloaded: number; files_duplicate: number }

interface Props {
  payers: PayerStat[]
  daily: DailyPoint[]
}

// Custom label rendered above each bar
const BarLabel = (props: any) => {
  const { x, y, width, value } = props
  if (!value) return null
  return (
    <text
      x={x + width / 2}
      y={y - 4}
      fill="#555"
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
    >
      {value}
    </text>
  )
}

export default function PayerChart({ payers, daily }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

      {/* Files by Type */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Files by Type (30 days)</h3>
        {payers.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">No data</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={payers}
                margin={{ top: 20, right: 8, bottom: 0, left: -20 }}
              >
                <XAxis dataKey="payer" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v: number) => [v, 'Files']}
                />
                <Bar dataKey="file_count" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="file_count" content={<BarLabel />} />
                  {payers.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-2">
              {payers.map((p, i) => (
                <div key={p.payer} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="capitalize">{p.payer}</span>
                  <span className="text-gray-400">({p.file_count})</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Daily Downloads */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Downloads (14 days)</h3>
        {daily.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={daily}
              margin={{ top: 20, right: 8, bottom: 24, left: -20 }}
            >
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                angle={-35}
                textAnchor="end"
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                labelFormatter={(l) => `Date: ${l}`}
                formatter={(v: number, name: string) =>
                  [v, name === 'files_downloaded' ? 'Total' : 'Duplicates']}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(v) => v === 'files_downloaded' ? 'Total files' : 'Duplicates'}
              />
              <Bar dataKey="files_downloaded" fill="#3b82f6" radius={[3, 3, 0, 0]}>
                <LabelList dataKey="files_downloaded" content={<BarLabel />} />
              </Bar>
              <Bar dataKey="files_duplicate" fill="#f59e0b" radius={[3, 3, 0, 0]}>
                <LabelList dataKey="files_duplicate" content={<BarLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

    </div>
  )
}
