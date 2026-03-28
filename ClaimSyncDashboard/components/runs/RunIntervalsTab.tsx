'use client'

import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { IntervalRecord } from './types'

interface Props {
  intervals: IntervalRecord[]
  loading: boolean
  facilityCode: string
  getToken: () => string | null
  apiPrefix?: string
}

export default function RunIntervalsTab({ intervals, loading, facilityCode, getToken, apiPrefix = '/api/claimssync/admin' }: Props) {
  const [xmlViewer, setXmlViewer] = useState<{ req: string; resp: string; idx: number; type: string } | null>(null)
  const [xmlLoading, setXmlLoading] = useState(false)

  const loadXml = async (reqBlob: string | null, respBlob: string | null, idx: number, type: string) => {
    const token = getToken()
    if (!token) return
    setXmlLoading(true)
    let reqXml = '', respXml = ''
    try {
      if (reqBlob) {
        const fname = reqBlob.replace('search_history/', '')
        const r = await fetch(`${apiPrefix}/facilities/${facilityCode}/search-history/${fname}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (r.ok) reqXml = await r.text()
      }
      if (respBlob) {
        const fname = respBlob.replace('search_history/', '')
        const r = await fetch(`${apiPrefix}/facilities/${facilityCode}/search-history/${fname}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (r.ok) respXml = await r.text()
      }
    } catch { /* ignore */ }
    setXmlViewer({ req: reqXml, resp: respXml, idx, type })
    setXmlLoading(false)
  }

  if (loading) {
    return (
      <div className="py-6 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading intervals...
      </div>
    )
  }

  if (intervals.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-gray-400">
        Interval detail not available for runs before engine v3.8
      </div>
    )
  }

  return (
    <>
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="grid grid-cols-7 gap-2 px-4 py-2 text-xs font-medium text-gray-400 uppercase bg-gray-50 border-b border-gray-200">
          <div>#</div>
          <div>Type</div>
          <div>From</div>
          <div>To</div>
          <div>Files</div>
          <div>Request</div>
          <div>Response</div>
        </div>
        <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
          {intervals.map(intv => (
            <div key={`${intv.type}_${intv.interval_index}`} className={`grid grid-cols-7 gap-2 px-4 py-2 items-center text-xs ${
              intv.response_exists ? 'bg-white' : 'bg-gray-50'
            }`}>
              <div className="text-gray-600 font-mono">{intv.interval_index}</div>
              <div><span className={`px-1.5 py-0.5 rounded text-xs ${
                intv.type === 'claim' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
              }`}>{intv.type}</span></div>
              <div className="text-gray-500">{intv.from_time || '\u2014'}</div>
              <div className="text-gray-500">{intv.to_time || '\u2014'}</div>
              <div className="text-gray-700 font-medium">{intv.files_found ?? '\u2014'}</div>
              <div>{intv.request_exists
                ? <span className="text-emerald-600 text-xs">Ready</span>
                : <span className="text-gray-300 text-xs">{'\u2014'}</span>
              }</div>
              <div className="flex items-center gap-2">
                {intv.response_exists
                  ? <span className="text-emerald-600 text-xs">Ready</span>
                  : <span className="text-gray-300 text-xs">{'\u2014'}</span>
                }
                {(intv.request_exists || intv.response_exists) && (
                  <button
                    onClick={() => loadXml(intv.request_blob, intv.response_blob, intv.interval_index, intv.type)}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    View
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* XML Viewer Modal */}
      {xmlViewer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">
                  Interval {xmlViewer.idx} — {xmlViewer.type}
                </h3>
                <p className="text-xs text-gray-400">Search history request/response XML</p>
              </div>
              <button onClick={() => setXmlViewer(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {xmlLoading ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-gray-200">
                <div className="flex flex-col">
                  <div className="px-4 py-2 bg-blue-50 border-b border-gray-200 text-xs font-medium text-blue-700">
                    Request XML (sent to Shafafiya)
                  </div>
                  <pre className="flex-1 p-4 text-xs text-gray-700 overflow-auto font-mono whitespace-pre-wrap break-all bg-gray-50">
                    {xmlViewer.req || '(not available)'}
                  </pre>
                </div>
                <div className="flex flex-col">
                  <div className="px-4 py-2 bg-emerald-50 border-b border-gray-200 text-xs font-medium text-emerald-700">
                    Response XML (from Shafafiya)
                  </div>
                  <pre className="flex-1 p-4 text-xs text-gray-700 overflow-auto font-mono whitespace-pre-wrap break-all bg-gray-50">
                    {xmlViewer.resp || '(not available)'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
