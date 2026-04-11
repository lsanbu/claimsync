'use client'

import { useState } from 'react'
import { Loader2, Download } from 'lucide-react'
import { FileRecord } from './types'
import { fmtDt, fmtSize, fileTypeBadge, fileTypeBadgeClass } from './helpers'

interface Props {
  files: FileRecord[]
  loading: boolean
  facilityCode: string
  runId: string
}

export default function RunFilesTab({ files, loading, facilityCode, runId }: Props) {
  const [filter, setFilter] = useState('')

  const exportCsv = () => {
    if (!files.length) return
    const header = 'Filename,File Type,Size,Uploaded At,Blob Path\n'
    const rows = files.map(r =>
      `"${r.file_name}","${fileTypeBadge(r.file_type, r.file_name)}","${fmtSize(r.file_size_bytes)}","${fmtDt(r.uploaded_at)}","${r.blob_path || ''}"`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${facilityCode}_run_${runId.slice(0, 8)}_files.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="py-6 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading files...
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between py-2">
        <input
          type="text"
          placeholder="Filter files..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
        <button
          onClick={exportCsv}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5 bg-white"
        >
          <Download className="w-3 h-3" /> Export CSV
        </button>
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="grid grid-cols-5 gap-3 px-4 py-2 text-xs font-medium text-gray-400 uppercase bg-gray-50 border-b border-gray-200">
          <div className="col-span-2">Filename</div>
          <div>Type</div>
          <div>Size</div>
          <div>Uploaded</div>
        </div>
        <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
          {files
            .filter(f => !filter || f.file_name.toLowerCase().includes(filter.toLowerCase()))
            .map(f => (
              <div key={f.file_id} className="grid grid-cols-5 gap-3 px-4 py-2 items-center text-xs">
                <div className="col-span-2 font-mono text-gray-700 truncate" title={f.file_name}>{f.file_name}</div>
                <div><span className={`px-1.5 py-0.5 rounded text-xs ${fileTypeBadgeClass(fileTypeBadge(f.file_type, f.file_name))}`}>{fileTypeBadge(f.file_type, f.file_name)}</span></div>
                <div className="text-gray-500">{fmtSize(f.file_size_bytes)}</div>
                <div className="text-gray-500">{fmtDt(f.uploaded_at)}</div>
              </div>
            ))}
          {files.length === 0 && (
            <div className="py-6 text-center text-xs text-gray-400">No files recorded</div>
          )}
        </div>
      </div>
    </>
  )
}
