// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Behaviour of the `dsh-audio-keepalive` client plugin.
 *
 * The plugin's whole contract is a browser concern, so the test drives the
 * DOM: it checks that the audio session is not opened before a gesture, that
 * the element it opens is playing and inaudible, that the session is
 * re-armed after it is lost, and that turning the plugin off puts the page
 * back the way it found it.
 */

/** Load the client plugin and activate it. */
async function activatePlugin() {
  let captured = null
  window.__ModuleLoader__ = {
    load(module) {
      captured = module
    },
  }
  vi.resetModules()
  await import('../client.js')
  if (captured === null) throw new Error('the client plugin did not register itself')
  const exports = captured.factory()
  const disposers = []
  const dictionaries = new Map()
  const services = new Map()
  exports.apply({
    effect(body) {
      disposers.push(body())
    },
    provide(name, service) {
      services.set(name, service)
    },
    get(name) {
      return services.get(name)
    },
    locale: {
      register(namespace, values) {
        dictionaries.set(namespace, values)
      },
      bind(namespace) {
        const values = dictionaries.get(namespace) || {}
        return (key) => values.zh?.[key] ?? values.en?.[key] ?? key
      },
    },
  })
  return { exports, disposers, services }
}

describe('dsh-audio-keepalive', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-keepalive')
    // jsdom does not implement media playback; the plugin only needs the
    // promise shape, and the test asserts on the calls. `paused` is a
    // read-only accessor in jsdom, so the stub shadows it per instance.
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      Object.defineProperty(this, 'paused', { value: false, configurable: true })
      return Promise.resolve()
    })
    window.HTMLMediaElement.prototype.pause = vi.fn(function pause() {
      Object.defineProperty(this, 'paused', { value: true, configurable: true })
    })
    window.HTMLMediaElement.prototype.load = vi.fn(function load() {})
  })

  it('does not open an audio session before a user gesture', async () => {
    const { services } = await activatePlugin()
    const keepAlive = services.get('dshAudioKeepAlive')

    expect(keepAlive.isArmed()).toBe(false)
    expect(keepAlive.state()).toBe('armed')
    expect(document.querySelector('audio')).toBeNull()
    expect(document.documentElement.getAttribute('data-dsh-keepalive')).toBe('armed')
  })

  it('opens a playing, inaudible session on the first gesture', async () => {
    const { services } = await activatePlugin()
    const keepAlive = services.get('dshAudioKeepAlive')

    window.dispatchEvent(new window.Event('pointerdown'))
    const audio = keepAlive.element()

    expect(audio).not.toBeNull()
    expect(audio.loop).toBe(true)
    expect(audio.volume).toBe(0)
    // A muted element holds no session on iOS; volume 0 does.
    expect(audio.muted).toBe(false)
    expect(audio.play).toHaveBeenCalled()
    expect(keepAlive.state()).toBe('holding')
    expect(document.documentElement.getAttribute('data-dsh-keepalive')).toBe('holding')
  })

  it('re-arms the session when the browser paused it', async () => {
    const { services } = await activatePlugin()
    const keepAlive = services.get('dshAudioKeepAlive')
    window.dispatchEvent(new window.Event('pointerdown'))
    const audio = keepAlive.element()
    Object.defineProperty(audio, 'paused', { value: true, configurable: true })
    audio.play.mockClear()

    keepAlive.start()
    window.dispatchEvent(new window.Event('pointerdown'))

    expect(audio.play).toHaveBeenCalled()
  })

  it('removes its element and releases the session when turned off', async () => {
    const { services } = await activatePlugin()
    const keepAlive = services.get('dshAudioKeepAlive')
    window.dispatchEvent(new window.Event('pointerdown'))
    expect(document.querySelector('audio')).not.toBeNull()

    keepAlive.setEnabled(false)

    expect(keepAlive.isEnabled()).toBe(false)
    expect(keepAlive.state()).toBe('off')
    expect(document.querySelector('audio')).toBeNull()
    expect(document.documentElement.getAttribute('data-dsh-keepalive')).toBe('off')
  })

  it('produces a silent WAV data URI', async () => {
    const { exports } = await activatePlugin()
    const uri = exports.silentWavDataUri()

    expect(uri.startsWith('data:audio/wav;base64,')).toBe(true)
    const bytes = Buffer.from(uri.split(',')[1], 'base64')
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WAVE')
    // Every sample is zero: the file is silence.
    const samples = bytes.subarray(44)
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every((byte) => byte === 0)).toBe(true)
  })
})
