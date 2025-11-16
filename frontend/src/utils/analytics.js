// frontend/src/utils/analytics.js
const state = {
  googleLoaded: false,
  metaLoaded: false,
  gtmLoaded: false,
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function normalizeEnv(value) {
  if (!value && value !== 0) return ''
  return String(value).trim()
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.src = src
    script.onload = () => resolve()
    script.onerror = reject
    document.head.appendChild(script)
  })
}

function onBodyReady(callback) {
  if (document.body) {
    callback()
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        callback()
      },
      { once: true }
    )
  }
}

function initGoogleTagManager(containerId) {
  if (state.gtmLoaded) return
  state.gtmLoaded = true

  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`
  document.head.appendChild(script)

  onBodyReady(() => {
    if (document.getElementById('gtm-noscript')) return
    const iframe = document.createElement('iframe')
    iframe.id = 'gtm-noscript'
    iframe.src = `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(containerId)}`
    iframe.height = 0
    iframe.width = 0
    iframe.style.display = 'none'
    iframe.style.visibility = 'hidden'
    document.body.appendChild(iframe)
  })
}

function initMetaPixel(pixelId) {
  if (state.metaLoaded) return
  state.metaLoaded = true

  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments)
    }
    if (!f._fbq) f._fbq = n
    n.push = n
    n.loaded = true
    n.version = '2.0'
    n.queue = []
    t = b.createElement(e)
    t.async = true
    t.src = v
    s = b.getElementsByTagName(e)[0]
    s.parentNode.insertBefore(t, s)
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js')

  window.fbq('init', pixelId)
  window.fbq('track', 'PageView')

  onBodyReady(() => {
    if (document.getElementById('meta-pixel-noscript')) return
    const img = document.createElement('img')
    img.id = 'meta-pixel-noscript'
    img.height = 1
    img.width = 1
    img.style.display = 'none'
    img.src = `https://www.facebook.com/tr?id=${encodeURIComponent(pixelId)}&ev=PageView&noscript=1`
    document.body.appendChild(img)
  })
}

export function initAnalytics() {
  if (!isBrowser()) return

  const gtmId = normalizeEnv(import.meta.env.VITE_GTM_ID)
  if (gtmId) {
    initGoogleTagManager(gtmId)
  }

  const metaPixelId = normalizeEnv(import.meta.env.VITE_META_PIXEL_ID)
  if (metaPixelId) initMetaPixel(metaPixelId)
}

function cleanParams(obj = {}) {
  const output = {}
  Object.entries(obj).forEach(([key, value]) => {
    if (value === undefined || Number.isNaN(value)) return
    if (value === null) {
      output[key] = null
      return
    }
    output[key] = value
  })
  return output
}

export function trackAnalyticsEvent(eventName, params = {}) {
  if (!isBrowser() || !eventName) return
  const payload = cleanParams({ event: eventName, ...params })
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push(payload)
}

export function trackMetaEvent(eventName, params = {}, options = {}) {
  if (!isBrowser() || !eventName || typeof window.fbq !== 'function') return
  const method = options.custom ? 'trackCustom' : 'track'
  try {
    window.fbq(method, eventName, cleanParams(params))
  } catch {}
}

