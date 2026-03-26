'use client'
import { usePathname } from 'next/navigation'

export default function ConditionalHeader() {
  const pathname = usePathname()

  // Hide main header on portal routes — they have their own headers
  if (pathname.startsWith('/admin') || pathname.startsWith('/reseller')) {
    return null
  }

  return (
    <header className="bg-brand-900 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-brand-500 rounded flex items-center justify-center text-xs font-bold">CS</div>
          <span className="font-semibold text-sm tracking-wide">ClaimSync</span>
          <span className="text-brand-100 text-xs hidden sm:block">— Shafafiya Automation</span>
        </div>
        <span className="text-xs text-brand-200">MF2618 · UAE North</span>
      </div>
    </header>
  )
}
