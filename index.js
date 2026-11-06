/**
 * `dsh-audio-keepalive` — hold the browser's audio session open.
 *
 * The whole implementation is client-side (see `client.js`): an audio session
 * is a browser concern, and the server has nothing to contribute.
 *
 * This entry point exists so the package is a valid Cordis plugin — the
 * loader requires a named export with an `apply` method.
 */

export const name = 'dsh-audio-keepalive'

export const inject = []

export function apply() {
  // The keep-alive runs entirely in the browser; see `client.js`.
}
