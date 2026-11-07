/**
 * `dsh-audio-keepalive` — hold the browser's audio session open.
 *
 * ## Why
 *
 * The Harness web UI can speak a finished task (`dsh-tts` with
 * `speakReplies`), which is the cheapest way to be told "the job is done"
 * without looking at the screen. On a phone that only works while the page
 * is in the foreground: iOS suspends a background tab, so the event that
 * announces the completion never arrives, and the announcement never plays.
 *
 * ## How it works
 *
 * iOS keeps a background page alive — timers, sockets, and all — while it
 * holds an active audio session. A media element that is *playing* provides
 * one. This plugin therefore plays a silent loop at volume 0 for as long as
 * the page is open.
 *
 * Two details matter:
 *
 *   - The element is **not** `muted`. A muted element does not hold a
 *     session on iOS; `volume = 0` does, and stays inaudible.
 *   - The session may only be opened by a **user gesture**. The plugin waits
 *     for the first tap, key press, or click, and starts then.
 *
 * The session is re-armed whenever it is lost: a phone call, a headphone
 * unplug, or iOS reclaiming the media session all pause the element, and the
 * plugin resumes it on the next tick or when the page becomes visible again.
 *
 * ## What it shows
 *
 * A small pill in the corner reports the state — armed, holding, or off — and
 * clicking it turns the keep-alive off. It is deliberately quiet: the point
 * is that the page keeps working, not that it adds noise.
 */

window.__ModuleLoader__.load({
  id: 'dsh-audio-keepalive',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** The namespace this plugin's own strings live in. */
    const NS = 'audio-keepalive'

    /** The plugin's own strings. */
    const en = {
      'state.off': 'Audio keep-alive off',
      'state.armed': 'Tap to arm audio keep-alive',
      'state.holding': 'Audio session held',
      'state.blocked': 'Tap once to allow announcements',
      'hint': 'Keeps this page able to speak while it is in the background.',
    }
    const zh = {
      'state.off': '音频保活已关闭',
      'state.armed': '点一下开启音频保活',
      'state.holding': '音频会话保持中',
      'state.blocked': '点一下允许播报',
      'hint': '让这个页面在后台时也能出声播报。',
    }

    /** The attribute that carries the plugin state on the document root. */
    const STATE_ATTR = 'data-dsh-keepalive'

    /** How often the session is checked and re-armed. */
    const CHECK_INTERVAL_MS = 5000

    /**
     * One second of silence, as a 8 kHz mono PCM WAV.
     *
     * The file is generated rather than shipped: a data URI keeps the
     * plugin a single file with no binary asset, and the content is silence.
     */
    function silentWavDataUri() {
      const sampleRate = 8000
      const samples = sampleRate
      const bytesPerSample = 2
      const dataSize = samples * bytesPerSample
      const buffer = new ArrayBuffer(44 + dataSize)
      const view = new DataView(buffer)
      const ascii = (offset, text) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
      }
      ascii(0, 'RIFF')
      view.setUint32(4, 36 + dataSize, true)
      ascii(8, 'WAVE')
      ascii(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate * bytesPerSample, true)
      view.setUint16(32, bytesPerSample, true)
      view.setUint16(34, 16, true)
      ascii(36, 'data')
      view.setUint32(40, dataSize, true)
      // The samples stay zero: silence.
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
      return `data:audio/wav;base64,${btoa(binary)}`
    }

    /**
     * The keep-alive itself.
     *
     * @param {object} options - Injection points for the test.
     * @returns {object} The controller.
     */
    function createKeepAlive(options = {}) {
      const doc = options.document || (typeof document !== 'undefined' ? document : null)
      const win = options.window || (typeof window !== 'undefined' ? window : null)
      const createAudio = options.createAudio || (() => (doc ? doc.createElement('audio') : null))
      const setState = options.setState || ((state) => {
        if (doc && doc.documentElement) doc.documentElement.setAttribute(STATE_ATTR, state)
      })

      let audio = null
      let timer = null
      let armed = false
      let enabled = true
      let blocked = false
      let onChange = null

      const state = () => {
        if (!enabled) return 'off'
        if (!armed) return 'armed'
        if (blocked) return 'blocked'
        return 'holding'
      }

      const publish = () => {
        setState(state())
        if (typeof onChange === 'function') onChange(state())
      }

      const ensurePlaying = () => {
        if (!enabled || !armed || !audio) return
        try {
          if (audio.paused) {
            const attempt = audio.play()
            if (attempt && typeof attempt.catch === 'function') {
              attempt.catch(() => {
                // The browser refused; a gesture is required before iOS lets a
                // page hold a session.
                blocked = true
                publish()
              })
            }
          }
          blocked = false
        } catch {
          blocked = true
        }
        publish()
      }

      const start = () => {
        if (armed || !enabled || !doc) return
        armed = true
        try {
          audio = createAudio()
          if (!audio) return
          audio.src = silentWavDataUri()
          audio.loop = true
          audio.preload = 'auto'
          audio.playsInline = true
          // Volume 0, never `muted`: a muted element holds no session on iOS.
          audio.volume = 0
          audio.setAttribute('data-dsh-keepalive', 'true')
          if (doc.body) doc.body.appendChild(audio)
        } catch {
          audio = null
          return
        }
        ensurePlaying()
        timer = win ? win.setInterval(ensurePlaying, CHECK_INTERVAL_MS) : null
        publish()
      }

      const stop = () => {
        if (timer && win) win.clearInterval(timer)
        timer = null
        const element = audio
        audio = null
        if (element) {
          // The element leaves the document first: tearing the source down can
          // throw in some browsers, and a half-removed element would keep the
          // page's audio session open.
          try { element.pause() } catch { /* already paused */ }
          try { element.remove() } catch { /* already detached */ }
          try { element.removeAttribute('src') } catch { /* no source */ }
          try { element.load?.() } catch { /* the browser may refuse */ }
        }
        armed = false
        blocked = false
        publish()
      }

      const setEnabled = (value) => {
        enabled = Boolean(value)
        if (!enabled) {
          stop()
          return
        }
        if (armed) {
          ensurePlaying()
          return
        }
        publish()
      }

      const onGesture = () => {
        if (!enabled) return
        // A gesture on an armed page is also the moment to recover a session
        // the browser took away — a call, a pair of headphones, a lock.
        if (armed) {
          ensurePlaying()
          return
        }
        start()
      }

      const onVisibility = () => {
        if (doc && doc.visibilityState === 'visible') ensurePlaying()
      }

      if (doc && win) {
        for (const type of ['pointerdown', 'touchstart', 'keydown', 'click']) {
          win.addEventListener(type, onGesture, { passive: true })
        }
        doc.addEventListener('visibilitychange', onVisibility)
      }
      publish()

      return {
        start,
        stop,
        setEnabled,
        state,
        isArmed: () => armed,
        isEnabled: () => enabled,
        element: () => audio,
        onChange(listener) {
          onChange = typeof listener === 'function' ? listener : null
          if (onChange) onChange(state())
        },
        destroy() {
          if (win) {
            for (const type of ['pointerdown', 'touchstart', 'keydown', 'click']) {
              win.removeEventListener(type, onGesture)
            }
          }
          if (doc) doc.removeEventListener('visibilitychange', onVisibility)
          stop()
        },
      }
    }

    /**
     * The indicator.
     *
     * @param {object} ctx - The client root context.
     * @param {object} keepAlive - The controller.
     */
    function install(ctx, keepAlive) {
      // `ctx` is a Cordis proxy: reading a service the host does not provide
      // throws ("cannot get property ... without inject"), so `ctx.document`
      // cannot be probed — the `||` below would never run. DOM is a global in
      // the browser, not a service: no DSH client package provides one, and
      // every other DOM-touching client plugin reads the global directly.
      const doc = typeof document !== 'undefined' ? document : null
      if (!doc || !doc.body) return
      const t = ctx?.locale?.bind ? ctx.locale.bind(NS) : (key) => key
      const pill = doc.createElement('button')
      pill.type = 'button'
      pill.setAttribute('data-dsh-keepalive-pill', 'true')
      pill.style.cssText = [
        'position:fixed',
        'right:12px',
        'bottom:12px',
        'z-index:2147483000',
        'display:flex',
        'align-items:center',
        'gap:6px',
        'padding:6px 10px',
        'border:0.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.35))',
        'border-radius:999px',
        'background:var(--dsw-alias-bg-layer-3,rgba(40,40,45,.82))',
        'color:var(--dsw-alias-label-secondary,rgba(235,235,245,.75))',
        'font:500 12px/1.2 system-ui,-apple-system,sans-serif',
        'backdrop-filter:blur(8px)',
        'cursor:pointer',
        'opacity:.55',
        'transition:opacity .2s',
      ].join(';')
      pill.addEventListener('click', () => {
        keepAlive.setEnabled(!keepAlive.isEnabled())
        render()
      })
      const render = () => {
        const state = keepAlive.state()
        pill.textContent = state === 'holding'
          ? `🔊 ${t('state.holding')}`
          : state === 'off'
            ? `🔇 ${t('state.off')}`
            : state === 'blocked'
              ? `🔈 ${t('state.blocked')}`
              : `🔈 ${t('state.armed')}`
        pill.style.opacity = state === 'holding' ? '.35' : '.75'
      }
      render()
      keepAlive.onChange(render)
      doc.body.appendChild(pill)
    }

    /**
     * Activate the plugin.
     *
     * @param {object} ctx - The client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'keep-alive dictionaries')
      const keepAlive = createKeepAlive()
      ctx.provide('dshAudioKeepAlive', keepAlive)
      ctx.effect(() => install(ctx, keepAlive), 'keep-alive indicator')
    }

    const inject = ['locale']

    exports.apply = apply
    exports.inject = inject
    exports.createKeepAlive = createKeepAlive
    exports.silentWavDataUri = silentWavDataUri
    return module.exports
  }
})
