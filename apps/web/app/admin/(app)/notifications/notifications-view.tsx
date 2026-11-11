'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { AssignedChannel, NotificationChannel, NotificationChannelType, NotificationEventType } from '@sentinel/shared'
import { api } from '../../../../lib/auth-client'
import { plural } from '../../../../lib/format'
import { EVENT_ORDER } from '../../../../lib/states'
import {
  Button,
  CHANNEL_TYPE_LABELS,
  Callout,
  ChannelRow,
  ConfirmDialog,
  EmptyState,
  EventToggles,
  Field,
  PageHeader,
  Select,
  Switch,
  Tag,
  TextField,
  Toast,
} from '../../../_components/ui'

const TYPES: NotificationChannelType[] = ['slack_bot', 'discord_bot', 'slack', 'discord', 'webhook', 'email']
const isBot = (t: NotificationChannelType) => t === 'slack_bot' || t === 'discord_bot'

const TYPE_HINT: Record<NotificationChannelType, string> = {
  slack_bot: 'One message per incident, updates in a thread. Needs a bot token (xoxb-…) with chat:write, invited to the channel.',
  discord_bot: 'One message per incident, updates in a thread. The bot needs View Channels, Send Messages, Create Public Threads, Send Messages in Threads and Embed Links.',
  slack: 'One message per event, posted to a Slack incoming webhook.',
  discord: 'One message per event, posted to a Discord webhook.',
  webhook: 'One JSON POST per event to your URL.',
  email: 'One email per event. Needs RESEND_API_KEY on the server.',
}

interface Form {
  name: string
  type: NotificationChannelType
  webhook_url: string
  email_to: string
  channel_ref: string
  bot_token: string
}

const empty: Form = { name: '', type: 'slack_bot', webhook_url: '', email_to: '', channel_ref: '', bot_token: '' }

function toForm(c: NotificationChannel): Form {
  return { name: c.name, type: c.type, webhook_url: c.webhook_url ?? '', email_to: (c.email_to ?? []).join(', '), channel_ref: c.channel_ref ?? '', bot_token: '' }
}

function payload(f: Form) {
  if (f.type === 'email') return { name: f.name.trim(), type: f.type, email_to: f.email_to.split(',').map((e) => e.trim()).filter(Boolean) }
  if (isBot(f.type)) return { name: f.name.trim(), type: f.type, channel_ref: f.channel_ref.trim(), ...(f.bot_token.trim() ? { bot_token: f.bot_token.trim() } : {}) }
  return { name: f.name.trim(), type: f.type, webhook_url: f.webhook_url.trim() }
}

/** Where a channel delivers, without secrets: the webhook host, the recipients or the channel ID. */
function detail(c: NotificationChannel): string {
  if (c.type === 'email') return (c.email_to ?? []).join(', ')
  if (isBot(c.type)) return `channel ${c.channel_ref ?? '—'}${c.has_bot_token ? '' : ' · no bot token stored'}`
  try {
    return c.webhook_url ? new URL(c.webhook_url).host : ''
  } catch {
    return ''
  }
}

function ChannelForm({ initial, storedToken, submitLabel, onSubmit, onCancel }: { initial: Form; storedToken: boolean; submitLabel: string; onSubmit: (f: Form) => Promise<string | void>; onCancel: () => void }) {
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  return (
    <form
      className="sn-stack"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        const err = await onSubmit(f)
        setBusy(false)
        if (err) setError(err)
      }}
    >
      <div className="sn-two" style={{ gap: 16 }}>
        <TextField id="c-name" label="Name" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={100} placeholder="#ops-alerts" />
        <Field label="Type" htmlFor="c-type" hint={TYPE_HINT[f.type]}>
          <Select id="c-type" value={f.type} onChange={(e) => set('type', e.target.value as NotificationChannelType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {CHANNEL_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {f.type === 'email' ? (
        <TextField id="c-email" label="Recipients" value={f.email_to} onChange={(e) => set('email_to', e.target.value)} required placeholder="oncall@example.com, team@example.com" hint="Comma separated, up to 10." />
      ) : isBot(f.type) ? (
        <div className="sn-two" style={{ gap: 16 }}>
          <TextField id="c-ref" label="Channel ID" value={f.channel_ref} onChange={(e) => set('channel_ref', e.target.value)} required maxLength={100} placeholder={f.type === 'slack_bot' ? 'C0123456789' : '123456789012345678'} />
          <TextField
            id="c-token"
            label="Bot token"
            type="password"
            autoComplete="off"
            value={f.bot_token}
            onChange={(e) => set('bot_token', e.target.value)}
            required={!storedToken}
            placeholder={storedToken ? 'Unchanged' : f.type === 'slack_bot' ? 'xoxb-…' : 'Bot token'}
            hint="Write-only: it is never shown again."
          />
        </div>
      ) : (
        <TextField id="c-url" label="Webhook URL" type="url" value={f.webhook_url} onChange={(e) => set('webhook_url', e.target.value)} required placeholder="https://hooks.example.com/…" />
      )}
      {error && <span className="sn-field__error" role="alert">{error}</span>}
      <div className="sn-row">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Channel({ channel, onDone, onError, onDelete }: { channel: NotificationChannel; onDone: (msg: string) => void; onError: (msg: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const [on, setOn] = useState(channel.enabled)
  const [sending, setSending] = useState(false)
  useEffect(() => setOn(channel.enabled), [channel.enabled])
  return (
    <ChannelRow name={channel.name} type={channel.type}>
      <Switch
        label={on ? 'On' : 'Off'}
        checked={on}
        onChange={async (e) => {
          const next = e.target.checked
          setOn(next)
          const res = await api(`/channels/${encodeURIComponent(channel.id)}`, { method: 'PATCH', body: { enabled: next } })
          if (!res.ok) {
            setOn(!next)
            onError(`Could not turn ${channel.name} ${next ? 'on' : 'off'}: ${res.error}`)
          } else onDone(`${channel.name} is ${next ? 'on' : 'off'}.`)
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={sending}
        onClick={async () => {
          setSending(true)
          const res = await api(`/channels/${encodeURIComponent(channel.id)}/test`, { method: 'POST' })
          setSending(false)
          if (res.ok) onDone(`Test message sent to ${channel.name}.`)
          else onError(`The test message to ${channel.name} failed: ${res.error}`)
        }}
      >
        {sending ? 'Sending…' : 'Send test message'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
        {editing ? 'Close' : 'Edit'}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDelete}>
        Delete
      </Button>
      <span className="sn-channel__detail">{detail(channel)}</span>
      {editing && (
        <div className="sn-channel__panel">
          <ChannelForm
            initial={toForm(channel)}
            storedToken={channel.has_bot_token}
            submitLabel="Save channel"
            onCancel={() => setEditing(false)}
            onSubmit={async (f) => {
              const res = await api(`/channels/${encodeURIComponent(channel.id)}`, { method: 'PATCH', body: payload(f) })
              if (!res.ok) return res.error
              setEditing(false)
              onDone('Channel saved.')
            }}
          />
        </div>
      )}
    </ChannelRow>
  )
}

function Route({ tag, route, onError, onSaved }: { tag: string; route: AssignedChannel; onError: (m: string) => void; onSaved: () => void }) {
  const [events, setEvents] = useState<NotificationEventType[]>(route.event_types)
  const [busy, setBusy] = useState(false)
  useEffect(() => setEvents(route.event_types), [route.event_types])
  return (
    <ChannelRow name={route.name} type={route.type}>
      <EventToggles
        value={events}
        disabled={busy}
        onToggle={async (ev) => {
          const next = EVENT_ORDER.filter((e) => (e === ev ? !events.includes(e) : events.includes(e)))
          if (next.length === 0) {
            onError('A route needs at least one event. Use Remove to stop this channel receiving the tag.')
            return
          }
          const prev = events
          setEvents(next)
          setBusy(true)
          const res = await api(`/tags/${encodeURIComponent(tag)}/channels`, { method: 'POST', body: { channel_id: route.id, event_types: next } })
          setBusy(false)
          if (!res.ok) {
            setEvents(prev)
            onError(`Could not change the events for ${route.name}: ${res.error}`)
          }
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const res = await api(`/tags/${encodeURIComponent(tag)}/channels/${encodeURIComponent(route.id)}`, { method: 'DELETE' })
          setBusy(false)
          if (!res.ok) onError(`Could not remove ${route.name} from ${tag}: ${res.error}`)
          else onSaved()
        }}
      >
        Remove
      </Button>
    </ChannelRow>
  )
}

/** Channels (where alerts go) and routing by tag (which tags reach which channel, for which events). */
export function NotificationsView({ channels, routes, tags, counts, failed }: { channels: NotificationChannel[]; routes: Record<string, AssignedChannel[]>; tags: string[]; counts: Record<string, number>; failed?: ReactNode }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<NotificationChannel | null>(null)
  const [newTag, setNewTag] = useState('')
  const [newChannel, setNewChannel] = useState('')
  const done = (m: string) => {
    setError(null)
    setToast(m)
    router.refresh()
  }
  const routed = tags.filter((t) => (routes[t] ?? []).length > 0)

  return (
    <>
      <PageHeader
        title="Notifications"
        meta={<span>Channels are where alerts go. Routing decides which tags reach which channel.</span>}
        actions={
          !creating && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Add channel
            </Button>
          )
        }
      />
      {failed}
      {error && (
        <Callout tone="outage" title="That did not save.">
          {error}
        </Callout>
      )}
      <section className="sn-narrow">
        <h2 className="sn-section__title sn-h">Channels</h2>
        {creating && (
          <div style={{ padding: '12px 0 24px' }}>
            <ChannelForm
              initial={empty}
              storedToken={false}
              submitLabel="Add channel"
              onCancel={() => setCreating(false)}
              onSubmit={async (f) => {
                const res = await api('/channels', { method: 'POST', body: { ...payload(f), enabled: true } })
                if (!res.ok) return res.error
                setCreating(false)
                done('Channel added. Route a tag to it below.')
              }}
            />
          </div>
        )}
        {channels.length === 0 && !creating && !failed ? (
          <EmptyState title="No channels yet" actions={<Button variant="primary" onClick={() => setCreating(true)}>Add channel</Button>}>
            A channel is where alerts go: a Slack or Discord bot, a webhook or email. Add one, then route tags to it. An agent can also do this through the MCP server.
          </EmptyState>
        ) : (
          channels.map((c) => <Channel key={c.id} channel={c} onDone={done} onError={setError} onDelete={() => setDeleting(c)} />)
        )}
      </section>
      <section className="sn-narrow">
        <h2 className="sn-section__title sn-h">Routing by tag</h2>
        {routed.length === 0 && <p className="sn-emptyline" style={{ marginBottom: 16 }}>No tag is routed to a channel yet, so only channels set on a test receive alerts.</p>}
        {routed.map((tag) => (
          <div key={tag} className="sn-route">
            <div className="sn-row">
              <Tag tag={tag} />
              <span className="sn-subtle">{plural(counts[tag] ?? 0, 'test')}</span>
            </div>
            {(routes[tag] ?? []).map((r) => (
              <Route key={r.id} tag={tag} route={r} onError={setError} onSaved={() => done(`${r.name} no longer receives ${tag}.`)} />
            ))}
          </div>
        ))}
        {channels.length > 0 && tags.length > 0 && (
          <form
            className="sn-row"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!newTag || !newChannel) return
              const res = await api(`/tags/${encodeURIComponent(newTag)}/channels`, { method: 'POST', body: { channel_id: newChannel, event_types: [...EVENT_ORDER] } })
              if (!res.ok) setError(`Could not route ${newTag}: ${res.error}`)
              else {
                setNewTag('')
                setNewChannel('')
                done(`${newTag} now reaches the channel for Outage, Degraded and Recovered.`)
              }
            }}
          >
            <Select aria-label="Tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} style={{ maxWidth: 240 }}>
              <option value="">Route a tag…</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select aria-label="Channel" value={newChannel} onChange={(e) => setNewChannel(e.target.value)} style={{ maxWidth: 240 }}>
              <option value="">to channel…</option>
              {channels
                .filter((c) => !newTag || !(routes[newTag] ?? []).some((r) => r.id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm" disabled={!newTag || !newChannel}>
              Add route
            </Button>
          </form>
        )}
      </section>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this channel?"
        confirmLabel="Delete channel"
        busyLabel="Deleting…"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return
          const res = await api(`/channels/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
          if (!res.ok) return `Could not delete the channel: ${res.error}`
          done(`${deleting.name} deleted.`)
        }}
      >
        Tags and tests routed to {deleting?.name ?? 'it'} stop sending alerts there.
      </ConfirmDialog>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  )
}
