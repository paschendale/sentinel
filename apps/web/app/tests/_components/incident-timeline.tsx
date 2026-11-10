import type { Incident } from '@sentinel/shared'
import { formatDuration } from '@sentinel/shared'

export function IncidentTimeline({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) {
    return <p className="text-zinc-600 text-sm mt-4">No incidents recorded.</p>
  }

  return (
    <div className="mt-6 w-full overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm border-collapse text-left">
        <thead>
          <tr className="text-zinc-600 text-xs tracking-widest uppercase">
            <th className="pb-4 pr-6 font-normal">Started</th>
            <th className="pb-4 pr-6 font-normal">Ended</th>
            <th className="pb-4 pr-6 font-normal text-right">Duration</th>
            <th className="pb-4 font-normal text-right">Failed checks</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((inc, i) => (
            <tr
              key={i}
              className="border-b border-zinc-800/80 last:border-0 hover:bg-zinc-900/40 transition-opacity duration-150"
            >
              <td className="py-3 pr-6 text-zinc-500 text-xs tabular-nums whitespace-nowrap">
                <time dateTime={inc.started_at}>
                  {new Date(inc.started_at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  })}
                </time>
              </td>
              <td className="py-3 pr-6 text-zinc-500 text-xs tabular-nums whitespace-nowrap">
                {inc.ongoing ? (
                  <span className="inline-flex items-center gap-1.5 text-red-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse shrink-0" aria-hidden />
                    Ongoing
                  </span>
                ) : (
                  <time dateTime={inc.ended_at}>
                    {new Date(inc.ended_at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'medium',
                    })}
                  </time>
                )}
              </td>
              <td className="py-3 pr-6 text-zinc-400 text-xs tabular-nums text-right whitespace-nowrap">
                {formatDuration(inc.duration_ms)}
              </td>
              <td className="py-3 text-zinc-400 text-xs tabular-nums text-right">
                {inc.failure_count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
