/*
 * The player UI's data store. Originally a from-scratch dual-element (separate
 * audio+video) MSE player; now an ADAPTER over the @videojs/react v10 + shaka
 * SABR engine. The whole control UI reads this `PlayerInstance` (via PlayerContext
 * + the use.ts hooks), so we keep the interface intact and back it with the single
 * shaka <video> element (`media.target`) + the shaka.Player (`media.engine`).
 */

import * as std from '@std'
import { useEffect, useState } from 'react'
import { useMedia } from '@videojs/react'
import { useAtomValue } from 'jotai'

import type { ShakaMedia } from '../sabr/ShakaMedia'
import { fetchSponsorBlock } from '@/parser/yt/video/sponsorblock'
import { playerDefaultQualityAtom } from '@/settings'

export enum PlayerState {
  Playing = 'playing',
  Paused = 'paused',
  Ended = 'ended',
  Error = 'error',
}

export type QualitySelection = { mode: 'auto' } | { mode: 'manual'; video: std.Source<std.SourceType.Video> }

export type PlayerInstance = {
  video: HTMLVideoElement
  audio: HTMLAudioElement

  play: () => void
  pause: () => void
  destroy: () => void

  id: string
  state: ValueListener<PlayerState>
  seekMS: ValueListener<number | undefined>
  currentScrubTimeMS: ValueListener<number | undefined>
  source: ValueListener<QualitySelection>
  sources: std.Source[]
  segments: Pick<ValueListener<std.PlayerSegments | undefined>, 'get' | 'onChange'>
  buffering: Pick<ValueListener<boolean>, 'get' | 'onChange'>
  bufferedRangesMS: Pick<ValueListener<[number, number][]>, 'get' | 'onChange'>
  volume: ValueListener<number>
  playbackRate: ValueListener<number>
  closedCaptions: ValueListener<std.ClosedCaption | undefined>
  allClosedCaptions: std.ClosedCaption[]
  currentTimeMS: Pick<ValueListener<number>, 'get'>
  durationMS: Pick<ValueListener<number | undefined>, 'get' | 'onChange'>
}

type OnChange<T> = (cb: (value: T) => void) => () => void
type ValueListener<T> = {
  get: () => T
  set: (value: T) => void
  onChange: OnChange<T>
}

const createValueListener = <Value>(initialValue: Value) => {
  let value: Value = initialValue
  let listeners: ((value: Value) => void)[] = []
  return {
    get: (): Value => value,
    set: (newValue: Value) => {
      if (value === newValue) return
      value = newValue
      for (const listener of listeners) listener(value)
    },
    onChange: (cb: (value: Value) => void) => {
      const uniqueCb = (value: Value) => cb(value)
      listeners.push(uniqueCb)
      return () => {
        listeners = listeners.filter((listener) => listener !== uniqueCb)
      }
    },
  }
}

// Minimal shaka surface the adapter touches.
type ShakaTrack = {
  id: number
  active: boolean
  height: number | null
  width: number | null
  frameRate: number | null
  bandwidth: number
  videoBandwidth?: number | null
  mimeType?: string | null
  videoMimeType?: string | null
}
type ShakaPlayerLike = {
  getVariantTracks: () => ShakaTrack[]
  selectVariantTrack: (track: ShakaTrack, clearBuffer?: boolean) => void
  configure: (config: Record<string, unknown>) => void
  setTextTrackVisibility: (visible: boolean) => void
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

const toSource = (track: ShakaTrack): std.Source<std.SourceType.Video> =>
  ({
    type: std.SourceType.Video,
    url: '',
    mimetype: track.videoMimeType ?? track.mimeType ?? undefined,
    width: track.width ?? 0,
    height: track.height ?? 0,
    frameRate: track.frameRate ?? 30,
    videoBitrate: track.videoBandwidth ?? track.bandwidth,
  }) as unknown as std.Source<std.SourceType.Video>

const createShakaPlayerInstance = ({
  video,
  player,
  videoId,
  allClosedCaptions,
  segments,
}: {
  video: HTMLVideoElement
  player: ShakaPlayerLike
  videoId: string
  allClosedCaptions: std.ClosedCaption[]
  segments: Pick<ValueListener<std.PlayerSegments | undefined>, 'get' | 'onChange'>
}): PlayerInstance => {
  const state = createValueListener(video.paused ? PlayerState.Paused : PlayerState.Playing)
  const seekMS = createValueListener<number | undefined>(undefined)
  const currentScrubTimeMS = createValueListener<number | undefined>(undefined)
  const buffering = createValueListener(video.readyState < 3)
  const bufferedRangesMS = createValueListener<[number, number][]>([])
  const volume = createValueListener(video.volume)
  const playbackRate = createValueListener(video.playbackRate)
  const durationMS = createValueListener<number | undefined>(
    Number.isNaN(video.duration) ? undefined : video.duration * 1000,
  )
  const closedCaptions = createValueListener<std.ClosedCaption | undefined>(undefined)

  // Quality: shaka variant tracks reshaped to std.Source, de-duped by height.
  const trackByHeight = new Map<number, ShakaTrack>()
  for (const track of player.getVariantTracks()) {
    if (track.height == null) continue
    if (!trackByHeight.has(track.height) || track.active) trackByHeight.set(track.height, track)
  }
  const sources = [...trackByHeight.values()].sort((a, b) => (b.height ?? 0) - (a.height ?? 0)).map(toSource)
  // Default to Auto (shaka ABR + restrictToElementSize); the Quality control pins a height.
  const source = createValueListener<QualitySelection>({ mode: 'auto' })

  // <video> → store wiring.
  const cleanups: (() => void)[] = []
  const on = <K extends keyof HTMLVideoElementEventMap>(type: K, handler: () => void) => {
    video.addEventListener(type, handler)
    cleanups.push(() => video.removeEventListener(type, handler))
  }
  const setDuration = () => durationMS.set(Number.isNaN(video.duration) ? undefined : video.duration * 1000)
  on('play', () => state.set(PlayerState.Playing))
  on('pause', () => state.set(PlayerState.Paused))
  on('ended', () => state.set(PlayerState.Ended))
  on('durationchange', setDuration)
  on('loadedmetadata', setDuration)
  on('volumechange', () => volume.set(video.volume))
  on('ratechange', () => playbackRate.set(video.playbackRate))
  on('waiting', () => buffering.set(true))
  on('stalled', () => buffering.set(true))
  on('playing', () => buffering.set(false))
  on('canplay', () => buffering.set(false))
  const onProgress = () => {
    const ranges: [number, number][] = []
    for (let i = 0; i < video.buffered.length; i++)
      ranges.push([video.buffered.start(i) * 1000, video.buffered.end(i) * 1000])
    if (ranges.length) bufferedRangesMS.set(ranges)
  }
  on('progress', onProgress)
  on('timeupdate', onProgress)

  // store → <video>/shaka wiring.
  state.onChange((next) => {
    if (next === PlayerState.Playing) video.play().catch(() => {})
    else if (next === PlayerState.Paused) video.pause()
  })
  seekMS.onChange((ms) => {
    if (ms !== undefined) video.currentTime = ms / 1000
  })
  volume.onChange((v) => {
    video.muted = false
    video.volume = Math.max(0, Math.min(1, v))
  })
  playbackRate.onChange((rate) => {
    video.playbackRate = rate
  })
  source.onChange((next) => {
    if (next.mode === 'auto') {
      player.configure({ abr: { enabled: true } })
      return
    }
    const track = trackByHeight.get(next.video.height ?? -1)
    if (!track) return
    player.configure({ abr: { enabled: false } })
    player.selectVariantTrack(track, true)
  })
  // Captions render in the custom word-level display, so keep shaka's native
  // VTT overlay off; the CC button drives `closedCaptions` only.
  player.setTextTrackVisibility(false)

  return {
    video,
    audio: video as unknown as HTMLAudioElement,
    play: () => state.set(PlayerState.Playing),
    pause: () => state.set(PlayerState.Paused),
    destroy: () => {
      for (const cleanup of cleanups) cleanup()
    },
    id: videoId,
    state,
    seekMS,
    currentScrubTimeMS,
    source,
    sources,
    segments,
    buffering: { get: buffering.get, onChange: buffering.onChange },
    bufferedRangesMS: { get: bufferedRangesMS.get, onChange: bufferedRangesMS.onChange },
    volume,
    playbackRate,
    closedCaptions,
    allClosedCaptions,
    currentTimeMS: { get: () => video.currentTime * 1000 },
    durationMS: { get: durationMS.get, onChange: durationMS.onChange },
  }
}

// Builds the adapter once the shaka <video> + player exist and tracks have loaded.
// Must be called inside <Player.Provider> so useMedia() resolves the ShakaMedia.
export const useShakaPlayerInstance = (videoId: string): { instance?: PlayerInstance; error?: Error } => {
  const media = useMedia() as ShakaMedia | null
  const [instance, setInstance] = useState<PlayerInstance | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const defaultQuality = useAtomValue(playerDefaultQualityAtom)

  useEffect(() => {
    if (!media) return
    let cancelled = false
    let built: PlayerInstance | undefined

    const segments = createValueListener<std.PlayerSegments | undefined>(undefined)
    fetchSponsorBlock(videoId)
      .then((s) => !cancelled && segments.set(s))
      .catch(() => {})

    const tryBuild = () => {
      if (built || cancelled) return
      if (media.error) {
        setError(media.error)
        clearInterval(interval)
        return
      }
      const video = media.target as HTMLVideoElement | null
      const player = media.engine as unknown as ShakaPlayerLike | undefined
      if (!video || !player?.getVariantTracks) return
      // Wait for shaka to load (tracks present) or at least video metadata.
      if (player.getVariantTracks().length === 0 && video.readyState < 1) return
      const allClosedCaptions =
        (media as unknown as { closedCaptions?: std.ClosedCaption[] }).closedCaptions ?? []
      built = createShakaPlayerInstance({ video, player, videoId, allClosedCaptions, segments })
      setInstance(built)
      clearInterval(interval)
    }

    const interval = setInterval(tryBuild, 100)
    tryBuild()

    return () => {
      cancelled = true
      clearInterval(interval)
      built?.destroy()
      setInstance(undefined)
      setError(undefined)
    }
  }, [media, videoId])

  useEffect(() => {
    if (!instance) return
    ;(media?.engine as unknown as ShakaPlayerLike | undefined)?.configure({
      abr: { restrictions: { maxWidth: defaultQuality } },
    })
  }, [media, instance, defaultQuality])

  return { instance, error }
}
