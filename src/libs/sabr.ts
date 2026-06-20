// Re-export the googlevideo SABR surface through a heimdall module so it
// resolves under vite (bare specifiers don't resolve from dynamic eval / the
// page context). The player drives YouTube's Server-ABR protocol with these.
export { SabrStream } from 'googlevideo/sabr-stream'
export { SabrStreamingAdapter, SabrUmpProcessor } from 'googlevideo/sabr-streaming-adapter'
export { RequestMetadataManager, FormatKeyUtils, buildSabrFormat } from 'googlevideo/utils'
export { VideoPlaybackAbrRequest } from 'googlevideo/protos'
export type { SabrFormat } from 'googlevideo/shared-types'
export type {
  SabrPlayerAdapter,
  PlayerHttpRequest,
  PlayerHttpResponse,
  RequestFilter,
  ResponseFilter,
  SabrRequestMetadata,
} from 'googlevideo/sabr-streaming-adapter'
