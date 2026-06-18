import {
  type AppendContinuationItemsResponse,
  getContinuationResponseItems,
} from '../components/continuation'
import type * as std from '@std'
import { fetchBrowseContinuation, makeContinuationIterator } from '../core/api'
import { fetchPlaylist } from './get'
import { type PlaylistVideo, processPlaylistVideo } from './processors/video'
import { type LockupViewModel, isLockupVideo, processLockupVideo } from '../video/processors/lockup'

const isVideo = (video: std.Video | undefined): video is std.Video => video !== undefined
const processPlaylistItem = (item: unknown): std.Video | undefined => {
  try {
    if (item && typeof item === 'object') {
      if ('playlistVideoRenderer' in item) return processPlaylistVideo(item as PlaylistVideo)
      if ('lockupViewModel' in item) {
        const lockup = (item as { lockupViewModel: LockupViewModel }).lockupViewModel
        if (isLockupVideo(lockup)) return processLockupVideo(lockup)
      }
    }
  } catch (error) {
    console.warn('Failed to process playlist video', error)
  }
  return undefined
}

export async function listUserPlaylists() {
  // todo: should use the getChannelPlaylists
  // todo: should always return watch later
  throw new Error('Not implemented')
}

type PlaylistVideosContinuationResponse = AppendContinuationItemsResponse<PlaylistVideo>
const fetchPlaylistVideosContinuation = fetchBrowseContinuation<PlaylistVideosContinuationResponse>

export function makeListPlaylistVideosIterator(id: string) {
  return makeContinuationIterator(
    () => fetchPlaylist(id).then((_) => _.playlistVideoList.playlistVideoListRenderer.contents),
    (token) => fetchPlaylistVideosContinuation(token).then(getContinuationResponseItems),
  )
}

export async function* listPlaylistVideos(id: string) {
  for await (const videos of makeListPlaylistVideosIterator(id)) {
    yield videos.map(processPlaylistItem).filter(isVideo)
  }
}
