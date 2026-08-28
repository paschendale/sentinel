import Link from 'next/link'
import { TokenGenerator } from './_components/token-generator'

export const dynamic = 'force-dynamic'

export default function TokensPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <Link href="/" className="text-zinc-100 text-lg hover:text-white transition-colors">sentinel</Link>
        <div className="flex items-center gap-6">
          <Link href="/status" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">status page</Link>
          <Link href="/notifications" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">notifications</Link>
          <Link href="/secrets" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">secrets</Link>
          <Link href="/tokens" className="text-zinc-300 text-sm">mcp</Link>
          <Link href="/tests/new" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">+ new test</Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto mt-8">
        <TokenGenerator />
      </div>
    </main>
  )
}
