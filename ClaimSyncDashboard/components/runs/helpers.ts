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
