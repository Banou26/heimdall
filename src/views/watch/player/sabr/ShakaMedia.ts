import shaka from 'shaka-player'
import type * as std from '@std'
import { DashMedia } from '@videojs/core/dom/media/dash'
import { SabrStreamingAdapter } from '@libs/sabr'
import { ShakaPlayerAdapter } from './ShakaPlayerAdapter'
import { getSabrSource } from './innertube'

// HTMLVideoElementHost isn't a public export; reach it as DashMedia's base class.
const HostBase = Object.getPrototypeOf(DashMedia) as new () => {
  target: HTMLVideoElement | null
  attach(target: HTMLVideoElement): void
  detach(): void
}

export const shakaMediaDefaultProps = { src: '', startTime: undefined as number | undefined }

// Video.js v10 media engine: Shaka owns the MSE timeline, the googlevideo adapter
// translates segment requests to SABR (fetched through the FKN extension).
export class ShakaMedia extends HostBase {
  #player?: shaka.Player
  #adapter?: SabrStreamingAdapter
  #src = ''
  #loading = false
  #error?: Error
  #closedCaptions: std.ClosedCaption[] = []
  startTime?: number

  get engine() {
    return this.#player
  }

  get error() {
    return this.#error
  }

  get closedCaptions(): std.ClosedCaption[] {
    return this.#closedCaptions
  }

  get src() {
    return this.#src
  }

  set src(videoId: string) {
    if (videoId === this.#src) return
    this.#src = videoId
    this.#maybeLoad()
  }

  attach(target: HTMLVideoElement) {
    super.attach(target)
    this.#maybeLoad()
  }

  detach() {
    this.#teardown()
    super.detach()
  }

  destroy() {
    this.#teardown()
  }

  #teardown() {
    try {
      this.#adapter?.dispose()
    } catch {
      /* */
    }
    try {
      this.#player?.destroy()
    } catch {
      /* */
    }
    this.#adapter = undefined
    this.#player = undefined
    this.#loading = false
    this.#error = undefined
  }

  #maybeLoad() {
    if (this.#loading || !this.target || !this.#src) return
    this.#loading = true
    this.#error = undefined
    const videoEl = this.target
    const videoId = this.#src
    void (async () => {
      shaka.polyfill.installAll()
      const source = await getSabrSource(videoId)
      this.#closedCaptions = source.closedCaptions
      const player = new shaka.Player()
      this.#player = player
      player.configure({
        // Prefer opus: some videos only serve opus over SABR, so m4a (itag 140) gets no media back.
        preferredAudioCodecs: ['opus', 'mp4a.40.2', 'mp4a.40.5'],
        // Matching the element size (what youtube's player does) keeps segments ~1-2 MB, so seeks stay fast.
        abr: { restrictToElementSize: true },
        streaming: {
          // A large goal makes GVS front-load a big burst per SABR response, which slows seeks.
          bufferingGoal: 4,
          // Resume as soon as the seek-point segment is decodable instead of accumulating buffer.
          rebufferingGoal: 0.2,
          bufferBehind: 30,
        },
      })
      await player.attach(videoEl)

      const adapter = new SabrStreamingAdapter({
        playerAdapter: new ShakaPlayerAdapter(),
        clientInfo: source.clientInfo as never,
      })
      this.#adapter = adapter
      adapter.setStreamingURL(source.serverAbrStreamingUrl)
      adapter.setUstreamerConfig(source.ustreamerConfig)
      adapter.setServerAbrFormats(source.formats)
      adapter.onMintPoToken(source.mintPoToken)
      adapter.onReloadPlayerResponse(async () => {
        try {
          const next = await getSabrSource(videoId)
          adapter.setStreamingURL(next.serverAbrStreamingUrl)
          adapter.setUstreamerConfig(next.ustreamerConfig)
          adapter.setServerAbrFormats(next.formats)
          console.log('[sabr] reload applied')
        } catch (e) {
          console.log('[sabr] reload FAILED', String((e as Error)?.message || e).slice(0, 160))
        }
      })
      adapter.attach(player)

      await player.load(source.manifestUri, this.startTime)
    })().catch((error) => {
      this.#loading = false
      this.#error =
        error instanceof Error
          ? error
          : new Error(
              error?.code != null
                ? `shaka error ${error.code} (category ${error.category})`
                : String(error?.message ?? error),
            )
      console.error('[ShakaMedia] failed to load', error)
    })
  }
}
