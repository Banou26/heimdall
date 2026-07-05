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

// youtubei.js ships a stale WEB clientVersion, which GVS caps at the ~60s preview.
const WEB_CLIENT_VERSION = '2.20260618.05.00'
;(Constants as unknown as { CLIENTS: { WEB: { VERSION: string } } }).CLIENTS.WEB.VERSION = WEB_CLIENT_VERSION

// InnerTube requests run through the FKN extension on the user's logged-in session
// (cookies + SAPISIDHASH); globalThis.__sabrCookieless forces the anonymous path.
const fknFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const request = input instanceof Request ? input : undefined
  const headers = new Headers(init?.headers ?? request?.headers)
  const cookieless = isCookieless()
  if (!cookieless && /(^|\.)youtube\.com$/.test(new URL(url).hostname)) {
    // SAPISIDHASH is validated against X-Origin; a mismatch silently degrades to the ~60s anonymous grant.
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

// Run youtubei.js's extracted sig/n decipher functions via new Function in the page context.
Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
  const properties: string[] = []
  if (env.n) properties.push(`n: exportedVars.nFunction("${env.n}")`)
  if (env.sig) properties.push(`sig: exportedVars.sigFunction("${env.sig}")`)
  const code = `${data.output}\nreturn { ${properties.join(', ')} }`
  return new Function(code)()
}

// WEB client only: the IOS client rejects WebPO tokens with streamProtectionStatus 2 forever.
let innertubePromise: Promise<Innertube> | undefined
const getInnertube = () => {
  if (!innertubePromise) {
    const visitor_data = (globalThis as Record<string, unknown>).__sabrVisitorData as string | undefined
    innertubePromise = Innertube.create({ fetch: fknFetch, retrieve_player: true, visitor_data })
  }
  return innertubePromise
}

const toBase64 = (str: string) => {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

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
  // The watch page carries the FULL-TIER player response; the /player API only issues
  // a preview-tier session GVS caps at ~60s. Each fetch yields a fresh authorized URL.
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

// Without the /api/stats/playback POST the cpn is unregistered and GVS caps at the ~60s preview.
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

export const getSabrSource = async (videoId: string): Promise<SabrSource> => {
  const innertube = await getInnertube()

  const { info, raw } = await getPlayerInfo(innertube, videoId)
  if (info.playability_status?.status !== 'OK')
    throw new Error(
      `sabr: cannot play (${info.playability_status?.status}: ${info.playability_status?.reason})`,
    )

  const sd = info.streaming_data
  // The adapter pins ONE audio itag and GVS returns no media for non-default xtags
  // variants (DRC/dubbed), so keep only the plain audio; video is untouched.
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
  // Without a cpn GVS caps at the ~60s preview; it must stay STABLE across reloads, so cache it.
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

  // WebPO binding: logged-IN binds to the datasyncId, logged-OUT to the videoId (FreeTube).
  const datasyncId = extractDatasyncId(info)
  const getPoToken = () => mintPoToken(datasyncId || videoId, innertube.session.context)

  // Structured caption tracks for the custom word-level display (shaka's VTT rendering is off).
  let closedCaptions: std.ClosedCaption[] = []
  try {
    const captions = (raw as unknown as { captions?: Parameters<typeof processCaptions>[0] }).captions
    if (captions) closedCaptions = processCaptions(captions, getPoToken)
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
    mintPoToken: getPoToken,
  }
}

// youtubei.js doesn't surface the datasyncId; dig it out of the raw responseContext.
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
