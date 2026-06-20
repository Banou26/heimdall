import shaka from 'shaka-player'
import { DashMedia } from '@videojs/core/dom/media/dash'
import { SabrStreamingAdapter } from '@libs/sabr'
import { ShakaPlayerAdapter } from './ShakaPlayerAdapter'
import { getSabrSource } from './innertube'

// HTMLVideoElementHost isn't a public export; it's DashMedia's base class.
// Importing DashMedia loads dashjs but never runs it (we don't `new` it).
const HostBase = Object.getPrototypeOf(DashMedia) as new () => {
  target: HTMLVideoElement | null
  attach(target: HTMLVideoElement): void
  detach(): void
}

export const shakaMediaDefaultProps = { src: '' }

// A Video.js v10 media engine backed by Shaka Player + the googlevideo SABR
// adapter. Video.js owns the UI/controls (driving the <video>); Shaka owns the
// MSE timeline + seeking; the adapter translates segment requests to SABR and
// demuxes UMP responses (fetched through the FKN extension).
export class ShakaMedia extends HostBase {
  #player?: shaka.Player
  #adapter?: SabrStreamingAdapter
  #src = ''
  #loading = false

  get engine() {
    return this.#player
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
  }

  #maybeLoad() {
    if (this.#loading || !this.target || !this.#src) return
    this.#loading = true
    const videoEl = this.target
    const videoId = this.#src
    void (async () => {
      shaka.polyfill.installAll()
      const source = await getSabrSource(videoId)
      const player = new shaka.Player()
      this.#player = player
      // Keep SABR bursts modest: the server streams up to the buffering goal in a
      // single response, and every byte is drained through the FKN relay.
      player.configure({ streaming: { bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 30 } })
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
      adapter.onReloadPlayerResponse(async (reloadContext: unknown) => {
        try {
          const next = await getSabrSource(videoId, reloadContext)
          adapter.setStreamingURL(next.serverAbrStreamingUrl)
          adapter.setUstreamerConfig(next.ustreamerConfig)
          adapter.setServerAbrFormats(next.formats)
          console.log('[sabr] reload applied')
        } catch (e) {
          console.log('[sabr] reload FAILED', String((e as Error)?.message || e).slice(0, 160))
        }
      })
      adapter.attach(player)

      await player.load(source.manifestUri)
    })().catch((error) => {
      let detail = ''
      try {
        detail = error?.data
          ? error.data
              .map((d: unknown) => String((d as Error)?.stack || (d as Error)?.message || d))
              .join(' || ')
          : ''
      } catch {
        /* */
      }
      ;(globalThis as Record<string, unknown>).__shakaMediaError = `code=${error?.code} cat=${
        error?.category
      } ${String(error?.message || error)} :: ${detail}`.slice(0, 1000)
      console.error('[ShakaMedia] failed to load', error)
    })
  }
}
