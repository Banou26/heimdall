import { extension } from '@fkn/lib'

// heimdall's networking runs entirely through the FKN web extension via the
// `extension.*` API of @fkn/lib. The request executes in the extension's service
// worker, so it is free of CORS, and we use the extension path explicitly (never
// the cloud-degrading layered `fetch`) because YouTube needs the user's own
// logged-in session, which only the extension can supply.
//
// `fetchProxy` forges Origin/Referer to the target's own origin so the request
// looks first-party - YouTube's SAPISIDHASH auth and its media CDNs reject
// anything else. Origin/Referer are forbidden headers a page can't normally set,
// but @fkn/lib forwards them to the real request (a backend proxy could set them
// too, so they aren't separately gated). `credentials: 'include'` attaches the
// user's real cookies for the target site.
export const fetchProxy = (url: string, init: RequestInit = {}): Promise<Response> => {
  const { origin } = new URL(url)
  const headers = new Headers(init.headers)
  if (!headers.has('origin')) headers.set('origin', origin)
  if (!headers.has('referer')) headers.set('referer', origin)
  return extension.fetch(url, { ...init, headers, credentials: init.credentials ?? 'include' })
}

export const cookies = extension.cookies
export const setRequestHeaderRule = extension.setRequestHeaderRule
export const removeRequestHeaderRule = extension.removeRequestHeaderRule
export const attachFrame = extension.attachFrame
