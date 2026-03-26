// app/reseller/layout.tsx
// Standalone layout for reseller portal — bypasses main dashboard layout
export default function ResellerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
