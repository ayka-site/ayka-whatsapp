import './globals.css'

export const metadata = {
  title: 'Dashboard',
  description: 'Management Dashboard',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
