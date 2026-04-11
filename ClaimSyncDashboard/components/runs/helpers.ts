export function fmtDt(dt: string | null) {
  if (!dt) return '\u2014'
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export function fmtSize(bytes: number | null) {
  if (bytes == null) return '\u2014'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function detectFileType(name: string): string {
  if (/^H/i.test(name)) return 'Claims'
  if (/^351/i.test(name)) return 'Remittance'
  if (/^RSB/i.test(name)) return 'Resubmission'
  return 'Other'
}

export function fileTypeBadge(dbType: string | null, fileName: string): string {
  const t = (dbType || '').toLowerCase()
  if (t === 'claims' || t === 'claim') return 'Claims'
  if (t === 'remittance') return 'Remittance'
  if (t === 'resubmission') return 'Resubmission'
  return detectFileType(fileName)
}

export function fileTypeBadgeClass(label: string): string {
  switch (label) {
    case 'Claims':       return 'bg-blue-50 text-blue-600'
    case 'Remittance':   return 'bg-green-50 text-green-600'
    case 'Resubmission': return 'bg-amber-50 text-amber-600'
    default:             return 'bg-gray-50 text-gray-500'
  }
}
