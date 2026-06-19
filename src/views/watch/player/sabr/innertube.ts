import { mintPoToken } from '@libs/botguard'
import { fetchProxy } from '@libs/extension'
import type { SabrFormat } from '@libs/sabr'
import { ClientType, Constants, Innertube } from 'youtubei.js/web'

// youtubei.js does the InnerTube heavy lifting (player response, signature
// deciphering, and - crucially - a SABR DASH manifest with a real segment
// timeline via toDash({ is_sabr: true })). Its requests are routed through the
// FKN extension (CORS-free, cookieless), matching heimdall's existing posture.
const fknFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const request = input instanceof Request ? input : undefined
  return fetchProxy(url, {
    method: init?.method ?? request?.method ?? 'GET',
    headers: new Headers(init?.headers ?? request?.headers),
    body: (init?.body as BodyInit | null) ?? undefined,
    credentials: 'omit',
  })
}

// Default (WEB) session for VideoInfo plumbing, but every player request uses the
// IOS client (cookieless, returns a playable server_abr_streaming_url + ustreamer
// config, no PO token needed for the response). The SABR adapter's clientInfo is
// built from youtubei.js's IOS client constants so it matches what was sent.
let innertubePromise: Promise<Innertube> | undefined
const getInnertube = () => {
  if (!innertubePromise) innertubePromise = Innertube.create({ fetch: fknFetch, retrieve_player: true })
  return innertubePromise
}

const toBase64 = (str: string) => btoa(String.fromCharCode(...new TextEncoder().encode(str)))

const buildSabrFormat = (f: Record<string, unknown>): SabrFormat =>
  ({
    itag: f.itag as number,
    lastModified: String(f.last_modified ?? f.last_modified_ms ?? ''),
    xtags: (f.xtags as string) ?? '',
    width: f.width as number,
    height: f.height as number,
    contentLength: Number(f.content_length ?? 0),
    mimeType: f.mime_type as string,
    bitrate: f.bitrate as number,
    averageBitrate: f.average_bitrate as number,
    audioQuality: f.audio_quality as string,
    audioSampleRate: String(f.audio_sample_rate ?? ''),
    approxDurationMs: Number(f.approx_duration_ms ?? 0),
    quality: f.quality as string,
    qualityLabel: f.quality_label as string,
    audioTrackId: (f.audio_track as { id?: string })?.id ?? '',
    language: (f.language as string) ?? null,
  }) as SabrFormat

export type SabrSource = {
  manifestUri: string
  serverAbrStreamingUrl: string
  ustreamerConfig: string
  formats: SabrFormat[]
  clientInfo: Record<string, unknown>
  durationMs: number
  mintPoToken: () => Promise<string>
}

export const getSabrSource = async (videoId: string): Promise<SabrSource> => {
  const innertube = await getInnertube()
  const info = await innertube.getInfo(videoId, { client: 'IOS' })
  const sd = info.streaming_data
  const rawUrl = sd?.server_abr_streaming_url
  if (!rawUrl) throw new Error('sabr: no server_abr_streaming_url in IOS player response')

  // WEB urls are signature-ciphered; IOS usually isn't - decipher if a player is present, else use raw.
  let serverAbrStreamingUrl = rawUrl
  try {
    const deciphered = await innertube.session.player?.decipher(rawUrl)
    if (deciphered) serverAbrStreamingUrl = deciphered
  } catch {
    /* raw url */
  }

  const ustreamerConfig = (
    info.page?.[0] as {
      player_config?: {
        media_common_config?: {
          media_ustreamer_request_config?: { video_playback_ustreamer_config?: string }
        }
      }
    }
  )?.player_config?.media_common_config?.media_ustreamer_request_config?.video_playback_ustreamer_config
  if (!ustreamerConfig) throw new Error('sabr: no video_playback_ustreamer_config')

  const mpd = await info.toDash({
    manifest_options: { is_sabr: true, captions_format: 'vtt', include_thumbnails: false },
  } as never)
  const manifestUri = `data:application/dash+xml;base64,${toBase64(mpd)}`

  // clientInfo MUST match the client that produced the streaming URL (IOS), not the
  // WEB session default - build it from youtubei.js's IOS client constants.
  const ios = (Constants as unknown as { CLIENTS: Record<string, Record<string, string>> }).CLIENTS.IOS
  const clientInfo = {
    clientName: Number((Constants.CLIENT_NAME_IDS as Record<string, string>)[ios.NAME]),
    clientVersion: ios.VERSION,
    deviceMake: 'Apple',
    deviceModel: ios.DEVICE_MODEL,
    osName: ios.OS_NAME,
    osVersion: ios.OS_VERSION,
  }

  return {
    manifestUri,
    serverAbrStreamingUrl,
    ustreamerConfig,
    formats: (sd.adaptive_formats ?? []).map((f) => buildSabrFormat(f as unknown as Record<string, unknown>)),
    clientInfo,
    durationMs: Number(info.basic_info?.duration ?? 0) * 1000,
    mintPoToken: () => mintPoToken(videoId),
  }
}
