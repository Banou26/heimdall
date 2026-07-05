import { fetchProxy } from '@libs/extension'
import { VideoPlaybackAbrRequest } from '@libs/sabr'

// SABR network layer: runs in the FKN extension SW with youtube.com Origin/Referer,
// on the user's logged-in session unless globalThis.__sabrCookieless is set.
export const sabrFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const headers = new Headers(init?.headers)
  headers.set('origin', 'https://www.youtube.com')
  headers.set('referer', 'https://www.youtube.com')
  const cookieless = !!(globalThis as Record<string, unknown>).__sabrCookieless
  // Real youtube.com sends clientAbrState.playbackAuthorization; without it GVS caps at the ~60s preview.
  let outBody = init?.body as BodyInit | null
  try {
    const b = init?.body
    const reqBytes =
      b instanceof Uint8Array
        ? b
        : ArrayBuffer.isView(b)
          ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
          : undefined
    if (reqBytes && /googlevideo\.com\/(videoplayback|initplayback)/.test(url)) {
      const d = VideoPlaybackAbrRequest.decode(reqBytes) as { clientAbrState?: Record<string, unknown> }
      if (d.clientAbrState && !d.clientAbrState.playbackAuthorization) {
        d.clientAbrState.playbackAuthorization = {
          authorizedFormats: [
            { trackType: 1, isHdr: false },
            { trackType: 2, isHdr: false },
            { trackType: 2, isHdr: true },
          ],
        }
        // A 0x0 viewport reads as "no video display" and can keep the stream at the preview tier.
        // drcEnabled intentionally unset: GVS would then expect the DRC variant Shaka never requests.
        d.clientAbrState.clientViewportWidth = 1280
        d.clientAbrState.clientViewportHeight = 720
        d.clientAbrState.av1QualityThreshold = 1080
        outBody = VideoPlaybackAbrRequest.encode(d as never).finish()
      }
    }
  } catch {
    /* leave body unchanged */
  }
  return fetchProxy(url, {
    method: init?.method ?? 'POST',
    headers,
    body: outBody ?? undefined,
    credentials: cookieless ? 'omit' : 'include',
    signal: init?.signal ?? undefined,
  })
}
