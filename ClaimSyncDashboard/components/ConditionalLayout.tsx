'use client'
import { usePathname } from 'next/navigation'

export default function ConditionalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isPortal = pathname.startsWith('/admin') || pathname.startsWith('/reseller')

  if (isPortal) {
    // Portal routes — render children with zero wrapping
    return <>{children}</>
  }

  // Main dashboard — full layout with header, nav, footer
  return (
    <div className="min-h-screen flex flex-col">
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
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
      <footer className="border-t border-gray-200 bg-white text-center text-xs text-gray-400 py-3">
        Kaaryaa GenAI Solutions · ClaimSync v1.2 · Phase 3
      </footer>
    </div>
  )
}
