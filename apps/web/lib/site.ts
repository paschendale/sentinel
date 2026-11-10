/**
 * The public status page's title. Optional `STATUS_PAGE_TITLE` (read by the web server at
 * request time); a fork may also change the default here. There is no branding setting in the UI.
 */
export function statusTitle(): string {
  return process.env.STATUS_PAGE_TITLE?.trim() || 'Service status'
}

/** Seconds the web server reuses a public API response (the API caches 30 s itself). */
export const PUBLIC_REVALIDATE = 30
