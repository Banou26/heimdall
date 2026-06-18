// YouTube's IOS client returns adaptive formats as separate, single-file video
// and audio tracks with byte-range index/init metadata - exactly a DASH
// SegmentBase representation. We assemble those into an MPD so a standard DASH
// player (video.js / dash.js) can do adaptive playback, with dash.js fetching
// each byte range through the FKN extension (see libs/media-proxy).

type ByteRange = { start: string | number; end: string | number }
type AdaptiveFormat = {
  itag: number
  url?: string
  mimeType: string
  bitrate: number
  width?: number
  height?: number
  fps?: number
  audioSampleRate?: string
  initRange?: ByteRange
  indexRange?: ByteRange
}
type StreamingData = { adaptiveFormats?: AdaptiveFormat[] }

const xmlEscape = (value: string | number) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const isoDuration = (seconds: number) =>
  `PT${Math.floor(seconds / 3600)}H${Math.floor((seconds % 3600) / 60)}M${(seconds % 60).toFixed(3)}S`

const splitMime = (raw: string): { mimeType: string; codecs: string } => {
  const [mimeType, ...rest] = raw.split(';')
  const codecs = rest.join(';').match(/codecs="(.+)"/)?.[1] ?? ''
  return { mimeType: mimeType.trim(), codecs }
}

const isPlayable = (
  format: AdaptiveFormat,
): format is AdaptiveFormat & { url: string; initRange: ByteRange; indexRange: ByteRange } =>
  Boolean(format.url && format.initRange && format.indexRange)

const representation = (
  format: AdaptiveFormat & { url: string; initRange: ByteRange; indexRange: ByteRange },
) => {
  const { codecs } = splitMime(format.mimeType)
  const isVideo = format.mimeType.startsWith('video')
  const dimensions = isVideo
    ? `width="${format.width}" height="${format.height}" frameRate="${format.fps ?? 30}"`
    : `audioSamplingRate="${format.audioSampleRate ?? 48000}"`
  return (
    `<Representation id="${format.itag}" codecs="${xmlEscape(codecs)}" bandwidth="${
      format.bitrate
    }" ${dimensions}>` +
    `<BaseURL>${xmlEscape(format.url)}</BaseURL>` +
    `<SegmentBase indexRange="${format.indexRange.start}-${format.indexRange.end}">` +
    `<Initialization range="${format.initRange.start}-${format.initRange.end}"/>` +
    `</SegmentBase></Representation>`
  )
}

type PlayableFormat = AdaptiveFormat & { url: string; initRange: ByteRange; indexRange: ByteRange }

const adaptationSet = (formats: PlayableFormat[], contentType: 'video' | 'audio') => {
  if (!formats.length) return ''
  const { mimeType } = splitMime(formats[0].mimeType)
  const lang = contentType === 'audio' ? ' lang="en"' : ''
  return (
    `<AdaptationSet contentType="${contentType}" mimeType="${mimeType}" subsegmentAlignment="true"${lang}>` +
    formats.map(representation).join('') +
    `</AdaptationSet>`
  )
}

export const buildDashManifest = (
  streamingData: StreamingData | undefined,
  durationSeconds: number,
): string | undefined => {
  const formats = (streamingData?.adaptiveFormats ?? []).filter(isPlayable)
  if (!formats.length) return undefined
  const videos = formats.filter((format) => format.mimeType.startsWith('video'))
  const audios = formats.filter((format) => format.mimeType.startsWith('audio'))
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" ' +
    `type="static" mediaPresentationDuration="${isoDuration(durationSeconds)}" minBufferTime="PT1.5S">` +
    '<Period>' +
    adaptationSet(videos, 'video') +
    adaptationSet(audios, 'audio') +
    '</Period></MPD>'
  )
}
