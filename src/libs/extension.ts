import { extension } from '@fkn/lib'

// CORS-free fetch in the FKN extension SW, defaulting Origin/Referer to the target's
// own origin (first-party look) and attaching the user's cookies for the target site.
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
