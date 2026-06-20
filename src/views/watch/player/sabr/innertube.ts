import { mintPoToken } from '@libs/botguard'
import { fetchProxy } from '@libs/extension'
import { buildSabrFormat } from '@libs/sabr'
import type { SabrFormat } from '@libs/sabr'
import type * as std from '@std'
import { processCaptions } from '@yt/video/processors/player/captions'
import { fetchSAPISID } from '@/parser/yt/core/api/sapisid'
import type { Types } from 'youtubei.js/web'
import { Constants, Innertube, Platform, Utils, YT } from 'youtubei.js/web'

const isCookieless = () => !!(globalThis as Record<string, unknown>).__sabrCookieless

// youtubei.js ships a stale WEB clientVersion; YouTube's GVS limits stale clients
// to the ~60s preview regardless of the PO token (real youtube.com sends a current
// version + only a ~10-byte cold-start token). Pin the live youtube.com web version.
const WEB_CLIENT_VERSION = '2.20260618.05.00'
;(Constants as unknown as { CLIENTS: { WEB: { VERSION: string } } }).CLIENTS.WEB.VERSION = WEB_CLIENT_VERSION

// youtubei.js does the InnerTube heavy lifting (player response, signature
// deciphering, and - crucially - a SABR DASH manifest with a real segment
// timeline via toDash({ is_sabr: true })). Its requests run through the FKN
// extension (CORS-free). By default they carry the user's logged-in YouTube
// session (cookies + SAPISIDHASH) so SABR streams past the ~60s anonymous grant;
// globalThis.__sabrCookieless forces the anonymous path.
const fknFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const request = input instanceof Request ? input : undefined
  const headers = new Headers(init?.headers ?? request?.headers)
  const cookieless = isCookieless()
  if (!cookieless && /(^|\.)youtube\.com$/.test(new URL(url).hostname)) {
    // SAPISIDHASH is validated against the request's X-Origin; it must match the
    // origin hashed in fetchSAPISID (https://www.youtube.com), or the auth silently
    // fails and the stream falls back to the anonymous ~60s grant. The browser won't
    // let us set Origin, so the extension forges Origin/Referer/X-Origin for us.
    if (!headers.has('authorization')) {
      const sapisid = await fetchSAPISID().catch(() => undefined)
      if (sapisid) headers.set('authorization', `SAPISIDHASH ${sapisid}`)
    }
    headers.set('x-origin', 'https://www.youtube.com')
    headers.set('origin', 'https://www.youtube.com')
    headers.set('referer', 'https://www.youtube.com/')
  }
  return fetchProxy(url, {
    method: init?.method ?? request?.method ?? 'GET',
    headers,
    body: (init?.body as BodyInit | null) ?? undefined,
    credentials: cookieless ? 'omit' : 'include',
  })
}

// The WEB player's server_abr_streaming_url is signature-ciphered; youtubei.js
// unlocks it by running the sig/n functions it extracted from the player JS.
// Route that through `new Function` (its default eval path) so the ciphered URL
// resolves in the page context.
Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
  const properties: string[] = []
  if (env.n) properties.push(`n: exportedVars.nFunction("${env.n}")`)
  if (env.sig) properties.push(`sig: exportedVars.sigFunction("${env.sig}")`)
  const code = `${data.output}\nreturn { ${properties.join(', ')} }`
  return new Function(code)()
}

// Default (WEB) client: its SABR streaming endpoint expects a WebPO attestation
// token bound to the videoId - exactly what bgutils/BotGuard mints. (The IOS
// client wants a native iOS attestation, so a WebPO token there is rejected with
// streamProtectionStatus 2 forever.) A real session visitorData (not generated
// locally) is needed for the server to return streaming_data without a login.
let innertubePromise: Promise<Innertube> | undefined
const getInnertube = () => {
  if (!innertubePromise) {
    const visitor_data = (globalThis as Record<string, unknown>).__sabrVisitorData as string | undefined
    innertubePromise = Innertube.create({ fetch: fknFetch, retrieve_player: true, visitor_data })
  }
  return innertubePromise
}

const toBase64 = (str: string) => btoa(String.fromCharCode(...new TextEncoder().encode(str)))

// One Client Playback Nonce per video, stable across reloads (the streaming session).
const cpnCache = new Map<string, string>()

export type SabrSource = {
  manifestUri: string
  serverAbrStreamingUrl: string
  ustreamerConfig: string
  formats: SabrFormat[]
  clientInfo: Record<string, unknown>
  durationMs: number
  closedCaptions: std.ClosedCaption[]
  mintPoToken: () => Promise<string>
}

// On a normal load, getBasicInfo builds the WEB /player request YouTube expects
// (a hand-rolled actions.execute('/player') returns UNPLAYABLE cookieless). On a
// server-requested reload (far seeks need a freshly-authorized streaming URL, or
// SABR keeps returning streamProtectionStatus 2), the request must carry the
// server's reloadPlaybackContext - getBasicInfo can't, so mirror its request
// shape via actions.execute and add the reload context.
// Extract the server-rendered ytInitialPlayerResponse JSON from a watch-page HTML
// (brace-balanced scan, since the JSON contains nested braces and quoted strings).
const extractInitialPlayerResponse = (html: string): unknown => {
  const i = html.indexOf('ytInitialPlayerResponse')
  if (i < 0) throw new Error('sabr: no ytInitialPlayerResponse in watch page')
  const start = html.indexOf('{', i)
  let depth = 0
  let inStr = false
  let esc = false
  for (let j = start; j < html.length; j++) {
    const c = html[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, j + 1))
  }
  throw new Error('sabr: unbalanced ytInitialPlayerResponse')
}

const getPlayerInfo = async (innertube: Innertube, videoId: string) => {
  // Do what the real youtube web player does: read the FULL-TIER player response
  // server-rendered into the watch page (both for the initial load AND on a server-
  // requested reload). The /player API only issues a PREVIEW-TIER session (a shorter
  // videoPlaybackUstreamerConfig) that GVS caps at ~60s. fetchProxy fetches the watch
  // page HTML through the FKN extension; each fetch yields a fresh authorized URL.
  const html = await fetchProxy(`https://www.youtube.com/watch?v=${videoId}`, {
    credentials: isCookieless() ? 'omit' : 'include',
  }).then((r) => r.text())
  const playerResponse = extractInitialPlayerResponse(html)
  const info = new YT.VideoInfo(
    [{ data: playerResponse } as never],
    innertube.actions,
    Utils.generateRandomString(16),
  )
  return { info, raw: playerResponse as Record<string, never> }
}

// Register the playback session: youtube's web player POSTs /api/stats/playback with
// the cpn after load. Without it the cpn is unregistered and GVS caps the stream at
// the ~60s preview. The base URL comes from the player response's playbackTracking.
const registerPlayback = (
  raw: Record<string, never>,
  cpn: string,
  audioItag?: number,
  videoItag?: number,
) => {
  const base = (raw as unknown as { playbackTracking?: { videostatsPlaybackUrl?: { baseUrl?: string } } })
    ?.playbackTracking?.videostatsPlaybackUrl?.baseUrl
  if (!base) return
  try {
    const u = new URL(base)
    u.searchParams.set('ver', '2')
    u.searchParams.set('cpn', cpn)
    if (videoItag) u.searchParams.set('fmt', String(videoItag))
    if (audioItag) u.searchParams.set('afmt', String(audioItag))
    void fetchProxy(u.toString(), { method: 'POST', credentials: isCookieless() ? 'omit' : 'include' }).catch(
      () => {},
    )
  } catch {
    /* best effort */
  }
}

export const getSabrSource = async (videoId: string, reloadContext?: unknown): Promise<SabrSource> => {
  const innertube = await getInnertube()

  const { info, raw } = await getPlayerInfo(innertube, videoId)
  if (info.playability_status?.status !== 'OK')
    throw new Error(
      `sabr: cannot play (${info.playability_status?.status}: ${info.playability_status?.reason})`,
    )

  const sd = info.streaming_data
  // YouTube serves several xtags variants of each audio itag (plain / DRC-normalised /
  // auto-dubbed). The real web player lists ALL of them and lets GVS pick; the Shaka
  // adapter instead pins ONE in selectedFormatIds, and GVS returns no media for a
  // non-default variant - playback then errors out. Keep only the plain (no-xtags,
  // non-dubbed) audio so the pinned format is always one GVS serves; video is untouched.
  const isPlainAudio = (f: unknown) => {
    const ff = f as { has_audio?: boolean; has_video?: boolean }
    return ff.has_audio && !ff.has_video
  }
  if (sd?.adaptive_formats) {
    const plain = sd.adaptive_formats.filter((f) => {
      const ff = f as {
        xtags?: string
        is_dubbed?: boolean
        is_descriptive?: boolean
        is_auto_dubbed?: boolean
      }
      return !(isPlainAudio(f) && (ff.xtags || ff.is_dubbed || ff.is_descriptive || ff.is_auto_dubbed))
    })
    if (plain.some(isPlainAudio)) sd.adaptive_formats = plain
  }
  const rawUrl = sd?.server_abr_streaming_url
  if (!rawUrl) throw new Error('sabr: no server_abr_streaming_url in player response')
  // The server_abr_streaming_url lacks the cpn (Client Playback Nonce) + alr that
  // youtube.com's web player appends; without cpn the server treats each request as
  // an untracked session and caps it at the ~60s preview. The cpn must be STABLE for
  // the whole playback (a fresh one per reload restarts the session), so cache it.
  let cpn = cpnCache.get(videoId)
  if (!cpn) {
    cpn = Utils.generateRandomString(16)
    cpnCache.set(videoId, cpn)
  }
  const deciphered = new URL(await innertube.session.player!.decipher(rawUrl))
  deciphered.searchParams.set('cpn', cpn)
  deciphered.searchParams.set('alr', 'yes')
  const serverAbrStreamingUrl = deciphered.toString()

  const fmts = sd?.adaptive_formats ?? []
  registerPlayback(
    raw,
    cpn,
    fmts.find((f) => !(f as { width?: number }).width)?.itag,
    fmts.find((f) => (f as { width?: number }).width)?.itag,
  )
  const ustreamerConfig =
    info.player_config?.media_common_config?.media_ustreamer_request_config?.video_playback_ustreamer_config
  if (!ustreamerConfig) throw new Error('sabr: no video_playback_ustreamer_config')

  const mpd = await info.toDash({
    manifest_options: { is_sabr: true, captions_format: 'vtt', include_thumbnails: false },
  } as never)
  const manifestUri = `data:application/dash+xml;base64,${toBase64(mpd)}`

  // clientInfo must match the client that produced the streaming URL (the WEB session).
  const client = innertube.session.context.client
  const clientInfo = {
    osName: client.osName,
    osVersion: client.osVersion,
    clientName: Number((Constants.CLIENT_NAME_IDS as Record<string, string>)[client.clientName]),
    clientVersion: client.clientVersion,
  }

  // GVS/SABR WebPO token binding (FreeTube's approach): logged-IN binds to the
  // account's datasyncId, logged-OUT to the videoId (mintAsWebsafeString(videoId)).
  const datasyncId = extractDatasyncId(info)

  // Structured caption tracks for the custom word-level display (the SABR manifest
  // also carries VTT, but shaka's native rendering is disabled in favour of this).
  let closedCaptions: std.ClosedCaption[] = []
  try {
    const captions = (raw as unknown as { captions?: Parameters<typeof processCaptions>[0] }).captions
    if (captions) closedCaptions = processCaptions(captions)
  } catch {
    /* video has no captions or an unexpected shape */
  }

  return {
    manifestUri,
    serverAbrStreamingUrl,
    ustreamerConfig,
    formats: (sd?.adaptive_formats ?? []).map((f) => buildSabrFormat(f as never)),
    clientInfo,
    durationMs: Number(info.basic_info?.duration ?? 0) * 1000,
    closedCaptions,
    // Full BotGuard integrity WebPO token from a session-bound /att/get challenge
    // (FreeTube's approach) - satisfies GVS attestation past the cold-start preview.
    mintPoToken: async () => mintPoToken(datasyncId || videoId, innertube.session.context),
  }
}

// The account session ID GVS binds a logged-in WebPO token to. youtubei.js doesn't
// surface it, so dig it out of the raw player response's responseContext.
const extractDatasyncId = (info: { page?: unknown[] }): string => {
  for (const page of info.page ?? []) {
    const rc =
      (page as { response_context?: unknown; responseContext?: unknown })?.response_context ??
      (page as { responseContext?: unknown })?.responseContext
    const ctx = rc as
      | {
          main_app_web_response_context?: { datasync_id?: string }
          mainAppWebResponseContext?: { datasyncId?: string }
        }
      | undefined
    const id = ctx?.main_app_web_response_context?.datasync_id ?? ctx?.mainAppWebResponseContext?.datasyncId
    if (id) return id.split('||')[0] ?? id
  }
  return ''
}
