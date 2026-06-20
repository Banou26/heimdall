import { mediaFetch } from '@libs/extension'
import { VideoPlaybackAbrRequest } from '@libs/sabr'

// Network layer for the googlevideo SABR client. Media segments stream through an
// extension-origin iframe (mediaFetch) over structured-clone postMessage - real bytes,
// no service-worker chrome.runtime/base64 hop - forging the youtube.com Origin/Referer
// the CDN expects. Cookieless: SABR media URLs are signature/PoToken-signed, so they
// don't need the user's cookies even for logged-in playback.
//
// The abort signal IS forwarded: the SABR adapter aborts each response after its first
// segment, and osra's abort-signal revivable propagates the cancel across the channel.
export const sabrFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const headers = new Headers(init?.headers)
  headers.set('origin', 'https://www.youtube.com')
  headers.set('referer', 'https://www.youtube.com')
  // The googlevideo adapter omits clientAbrState.playbackAuthorization, but real
  // youtube.com sends it (authorizedFormats: audio + video + HDR video). Without it
  // GVS limits the stream to the ~60s preview. Inject it into the SABR request body.
  let outBody = init?.body as BodyInit | null
  try {
    const b = init?.body
    const reqBytes =
      b instanceof Uint8Array
        ? b
        : ArrayBuffer.isView(b)
          ? new Uint8Array((b as ArrayBufferView).buffer)
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
        // youtube.com sends a real viewport + quality hints; a 0x0 viewport reads as
        // "no video display" and can keep the stream at the preview tier. (drcEnabled
        // is intentionally NOT set: it makes GVS expect the DRC audio variant, but
        // Shaka requests the plain itag, so multi-variant videos get no media back.)
        d.clientAbrState.clientViewportWidth = 1280
        d.clientAbrState.clientViewportHeight = 720
        d.clientAbrState.av1QualityThreshold = 1080
        outBody = VideoPlaybackAbrRequest.encode(d as never).finish()
      }
    }
  } catch {
    /* leave body unchanged */
  }
  return mediaFetch(url, {
    method: init?.method ?? 'POST',
    headers,
    body: outBody ?? undefined,
    signal: init?.signal ?? undefined,
  })
}
