import type { ForkExtension } from '../extensions.js'

/**
 * A fork's additions to the API. Upstream ships this empty and never changes it; a fork
 * replaces it, so pulling upstream does not conflict here. See docs/FORKING.md.
 */
export const fork: ForkExtension = {}
