// app/admin/layout.tsx
// Standalone layout for admin portal — bypasses main dashboard layout
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
