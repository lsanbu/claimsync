'use client'
import { useState, useCallback } from 'react'
import { FileRecord, Page, apiFetch, parsePayer, fmtDate } from '@/lib/api'
import { Copy, CheckCheck, Filter, X } from 'lucide-react'

const PAGE_SIZE = 20

export default function FileBrowser({ initialData }: { initialData: Page<FileRecord> }) {
  const [data, setData]               = useState<Page<FileRecord>>(initialData)
  const [offset, setOffset]           = useState(0)
  const [loading, setLoading]         = useState(false)
  const [isDupFilter, setIsDupFilter] = useState<boolean | undefined>(undefined)
  const [typeFilter, setTypeFilter]   = useState('')
  const [dateFilter, setDateFilter]   = useState('')   // YYYY-MM-DD
  const [copiedId, setCopiedId]       = useState<string | null>(null)

  const load = useCallback(async (
    off: number,
    dup?: boolean,
    type?: string,
    date?: string
  ) => {
    setLoading(true)
    try {
      const params: Record<string, string | number | boolean> = {
        limit: PAGE_SIZE, offset: off
      }
      if (dup !== undefined) params.is_duplicate = dup
      if (type) params.file_type = type
      if (date) {
        // Convert YYYY-MM-DD to date range for the day
        params.date_from = `${date}T00:00:00Z`
        params.date_to   = `${date}T23:59:59Z`
      }
      const res = await apiFetch<Page<FileRecord>>('files', params)
      setData(res)
      setOffset(off)
    } finally {
      setLoading(false)
    }
  }, [])

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const clearFilters = () => {
    setTypeFilter('')
    setIsDupFilter(undefined)
    setDateFilter('')
    load(0, undefined, '', '')
  }

  const hasFilters = typeFilter || isDupFilter !== undefined || dateFilter

  const totalPages  = Math.ceil(data.total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="space-y-3">

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
          <Filter className="w-3.5 h-3.5" /> Filter:
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value)
            load(0, isDupFilter, e.target.value, dateFilter)
          }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
        >
          <option value="">All types</option>
          <option value="claims">Claims</option>
          <option value="resubmission">Resubmission</option>
          <option value="remittance">Remittance</option>
          <option value="unknown">Unknown</option>
        </select>

        {/* Dup filter */}
        <select
          value={isDupFilter === undefined ? '' : String(isDupFilter)}
          onChange={(e) => {
            const val = e.target.value === '' ? undefined : e.target.value === 'true'
            setIsDupFilter(val)
            load(0, val, typeFilter, dateFilter)
          }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
        >
          <option value="">All files</option>
          <option value="false">Unique only</option>
          <option value="true">Duplicates only</option>
        </select>

        {/* Date filter */}
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => {
            setDateFilter(e.target.value)
            load(0, isDupFilter, typeFilter, e.target.value)
          }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-200"
          title="Filter by download date"
        />

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-2 py-1.5 hover:bg-gray-50 transition-colors"
            title="Clear all filters"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400">{data.total} files</span>
      </div>

      {/* Active filter pills */}
      {hasFilters && (
        <div className="flex flex-wrap gap-1.5">
          {typeFilter && (
            <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2 py-0.5 capitalize">
              {typeFilter}
            </span>
          )}
          {isDupFilter !== undefined && (
            <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-2 py-0.5">
              {isDupFilter ? 'Duplicates only' : 'Unique only'}
            </span>
          )}
          {dateFilter && (
            <span className="text-xs bg-purple-50 text-purple-600 border border-purple-200 rounded-full px-2 py-0.5">
              📅 {dateFilter}
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-8">#</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500">File Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden sm:table-cell">Payer</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden md:table-cell">Type</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden lg:table-cell">Downloaded</th>
                <th className="text-center px-4 py-2.5 font-medium text-gray-500">Dup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading…</td></tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    No files found{hasFilters ? ' for selected filters' : ''}.
                  </td>
                </tr>
              ) : data.items.map((file, i) => (
                <tr key={file.file_id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-2.5 text-gray-400">{offset + i + 1}</td>
                  <td className="px-4 py-2.5 max-w-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-gray-700" title={file.file_name}>
                        {file.file_name}
                      </span>
                      <button
                        onClick={() => copyId(file.file_id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Copy file ID"
                      >
                        {copiedId === file.file_id
                          ? <CheckCheck className="w-3 h-3 text-emerald-500" />
                          : <Copy className="w-3 h-3 text-gray-400" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 hidden sm:table-cell whitespace-nowrap">
                    {parsePayer(file.file_name)}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                      {file.file_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell whitespace-nowrap">
                    {fmtDate(file.downloaded_at)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {file.is_duplicate
                      ? <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Duplicate" />
                      : <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="Unique" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500">
            <span>Page {currentPage} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => load(Math.max(0, offset - PAGE_SIZE), isDupFilter, typeFilter, dateFilter)}
                disabled={offset === 0}
                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                ← Prev
              </button>
              <button
                onClick={() => load(offset + PAGE_SIZE, isDupFilter, typeFilter, dateFilter)}
                disabled={offset + PAGE_SIZE >= data.total}
                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
