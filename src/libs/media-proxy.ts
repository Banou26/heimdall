import { fetchProxy } from '@libs/extension'

// dash.js fetches every media segment from googlevideo, which sends no CORS
// headers - so a page-context request can't read the response. Route just those
// requests through the FKN extension (CORS-free in its service worker), forging
// the youtube.com Origin/Referer the CDN expects. dash.js uses the Fetch loader
// for low-latency live and the XHR loader for VOD, so both are intercepted.
const isMediaHost = (host: string) => host === 'googlevideo.com' || host.endsWith('.googlevideo.com')
const hostOf = (url: string): string => {
  try {
    return new URL(url, location.href).host
  } catch {
    return ''
  }
}
const forgeOrigin = (headers: Headers): Headers => {
  headers.set('origin', 'https://www.youtube.com')
  headers.set('referer', 'https://www.youtube.com')
  return headers
}

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const installFetchProxy = () => {
  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isMediaHost(hostOf(requestUrl(input)))) return original(input, init)
    const request = input instanceof Request ? input : undefined
    return fetchProxy(requestUrl(input), {
      method: init?.method ?? request?.method ?? 'GET',
      headers: forgeOrigin(new Headers(init?.headers ?? request?.headers)),
      body: init?.body ?? undefined,
      credentials: 'omit',
      // No signal on purpose - aborting a proxyFetch wedges the extension relay.
    })
  }
}

const installXhrProxy = () => {
  const Native = window.XMLHttpRequest

  class ProxyXHR extends Native {
    #proxy = false
    #url = ''
    #method = 'GET'
    #headers: [string, string][] = []
    #aborted = false
    #responseHeaders?: Headers

    open(method: string, url: string | URL, ...rest: unknown[]) {
      this.#method = method
      this.#url = typeof url === 'string' ? url : String(url)
      this.#proxy = isMediaHost(hostOf(this.#url))
      // @ts-expect-error variadic passthrough to the platform method
      return super.open(method, url, ...rest)
    }

    setRequestHeader(name: string, value: string) {
      if (this.#proxy) this.#headers.push([name, value])
      else super.setRequestHeader(name, value)
    }

    send(body?: Document | XMLHttpRequestBodyInit | null) {
      if (!this.#proxy) return super.send(body)
      // Deliberately NOT forwarding an AbortSignal: dash.js aborts on every seek, so we
      // let the request finish in the background and discard its result when aborted.
      fetchProxy(this.#url, {
        method: this.#method,
        headers: forgeOrigin(new Headers(this.#headers)),
        credentials: 'omit',
      })
        .then(async (response) => {
          // Read the body to completion even when aborted, then discard if so.
          const buffer = await response.arrayBuffer()
          if (this.#aborted) return
          this.#responseHeaders = response.headers
          const shadow = (key: string, value: unknown) =>
            Object.defineProperty(this, key, { configurable: true, get: () => value })
          shadow('readyState', 4)
          shadow('status', response.status)
          shadow('statusText', response.statusText)
          shadow('responseURL', this.#url)
          shadow(
            'response',
            this.responseType === 'text' || this.responseType === ''
              ? new TextDecoder().decode(buffer)
              : buffer,
          )
          this.dispatchEvent(new Event('readystatechange'))
          this.dispatchEvent(
            new ProgressEvent('progress', {
              lengthComputable: true,
              loaded: buffer.byteLength,
              total: buffer.byteLength,
            }),
          )
          this.dispatchEvent(new ProgressEvent('load'))
          this.dispatchEvent(new ProgressEvent('loadend'))
        })
        .catch(() => {
          // abort() already fired abort/loadend synchronously; don't double-fire.
          if (this.#aborted) return
          this.dispatchEvent(new ProgressEvent('error'))
          this.dispatchEvent(new ProgressEvent('loadend'))
        })
    }

    abort() {
      if (!this.#proxy) return super.abort()
      this.#aborted = true
      // Native abort() ends the request synchronously and fires these events;
      // dash.js waits for them before issuing the next (e.g. post-seek) request.
      Object.defineProperty(this, 'readyState', { configurable: true, get: () => 4 })
      this.dispatchEvent(new Event('readystatechange'))
      this.dispatchEvent(new ProgressEvent('abort'))
      this.dispatchEvent(new ProgressEvent('loadend'))
    }

    getAllResponseHeaders() {
      if (!this.#proxy) return super.getAllResponseHeaders()
      let out = ''
      this.#responseHeaders?.forEach((value, key) => {
        out += `${key}: ${value}\r\n`
      })
      return out
    }

    getResponseHeader(name: string) {
      if (!this.#proxy) return super.getResponseHeader(name)
      return this.#responseHeaders?.get(name) ?? null
    }
  }

  window.XMLHttpRequest = ProxyXHR as unknown as typeof XMLHttpRequest
}

let installed = false
export const installMediaFetchProxy = () => {
  if (installed || typeof window === 'undefined') return
  installed = true
  installFetchProxy()
  installXhrProxy()
}
