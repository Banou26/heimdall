import { fetchProxy } from '@libs/extension'

// Network layer for the googlevideo SABR client. Every SABR request runs in the
// FKN extension service worker (CORS-free), cookieless, forging the youtube.com
// Origin/Referer the media endpoint expects.
//
// The signal is deliberately dropped: googlevideo's SabrStream attaches a
// per-request timeout AbortController, but aborting an in-flight proxyFetch
// wedges the extension's osra relay for every later request. We never forward
// it and instead rely on the library's own retry/stall handling; in-flight
// requests are left to finish and drain in the background.
export const sabrFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const headers = new Headers(init?.headers)
  headers.set('origin', 'https://www.youtube.com')
  headers.set('referer', 'https://www.youtube.com')
  return fetchProxy(url, {
    method: init?.method ?? 'POST',
    headers,
    body: (init?.body as BodyInit | null) ?? undefined,
    credentials: 'omit',
  })
}
