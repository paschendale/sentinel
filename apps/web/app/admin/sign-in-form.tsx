'use client'

import { useState } from 'react'
import { API_URL, setToken } from '../../lib/auth-client'
import { Brand, Button, TextField } from '../_components/ui'

export function SignInForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        setError(res.status === 401 ? 'Wrong username or password. Check both and try again.' : `Sign-in failed: the API answered ${res.status}. Retry in a moment.`)
        return
      }
      const { token } = (await res.json()) as { token: string }
      setToken(token)
      window.location.assign('/admin/tests')
    } catch {
      setError('Could not reach the API. Check that it is running, then retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="sn-login sn">
      <Brand size={36} />
      <form className="sn-stack" onSubmit={(e) => void submit(e)}>
        <TextField id="username" label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        <TextField id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <a className="sn-back" href="/" style={{ margin: 0 }}>
        ← Status page
      </a>
    </main>
  )
}
