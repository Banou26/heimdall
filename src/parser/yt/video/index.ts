import * as std from '@std'
import {
  fetchVideo,
  fetchRecommended,
  fetchPlayer,
  fetchCompactVideoContinuation,
  fetchSetVideoLikeStatus,
  fetchVideoLikeCounts,
  fetchRecommendedContinuation,
} from './api'
import { fetchSponsorBlock } from './sponsorblock'

import { isLiveBadge, type MetadataBadge } from '../components/badge'
import { findRenderer, findRendererRaw, isRenderer, type Renderer } from '../core/internals'
import { processFullVideo } from './processors/full'
import { makeContinuationIterator } from '@yt/core/api'
import type { RichItem } from '@yt/components/item'
import { processVideo, type Video } from './processors/regular'
import { type LockupViewModel, isLockupVideo, processLockupVideo } from './processors/lockup'
import { type CompactVideo, processCompactVideo } from './processors/compact'
import { processPlayer } from './processors/player'
import { getContinuationResponseItems } from '../components/continuation'
import { isLiveThumbnailOverlay, type ThumbnailOverlays } from '../components/thumbnail'
export * from './types'

export async function* listRecommended(): AsyncGenerator<std.Video[]> {
  const recommendedVideosIterator = makeContinuationIterator(
    () =>
      fetchRecommended().then(
        (response) =>
          response.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer
            .contents,
      ),
    (token) => fetchRecommendedContinuation(token).then(getContinuationResponseItems),
  )
  for await (const recommendedVideos of recommendedVideosIterator) {
    yield recommendedVideos
      .filter((renderer): renderer is RichItem<Video | Renderer<'radio'>> => 'richItemRenderer' in renderer)
      .map((renderer) => renderer.richItemRenderer.content)
      .map(processRecommendedItem)
      .filter((video): video is std.Video => video !== undefined)
  }
}

// The home feed mixes the legacy `videoRenderer`, the newer `lockupViewModel`
// (now the common case), ad slots and playlist lockups. Pull videos out of the
// first two and skip the rest; a single bad item degrades to a skip.
const processRecommendedItem = (
  content: Video | Renderer<'radio'> | { lockupViewModel: LockupViewModel },
): std.Video | undefined => {
  try {
    if ('videoRenderer' in content) return processVideo(content)
    if ('lockupViewModel' in content && isLockupVideo(content.lockupViewModel)) {
      return processLockupVideo(content.lockupViewModel)
    }
  } catch (error) {
    console.warn('Failed to process recommended item', error)
  }
  return undefined
}

// Related videos migrated from `compactVideoRenderer` to `lockupViewModel`; handle both.
const processRelatedItem = (
  item: CompactVideo | { lockupViewModel: LockupViewModel } | Renderer,
): std.Video | undefined => {
  try {
    if ('compactVideoRenderer' in item) return processCompactVideo(item as CompactVideo)
    const lockup = (item as { lockupViewModel?: LockupViewModel }).lockupViewModel
    if (lockup && isLockupVideo(lockup)) return processLockupVideo(lockup)
  } catch (error) {
    console.warn('Failed to process related item', error)
  }
  return undefined
}

export async function getVideo(videoId: string): Promise<std.Video> {
  console.log('getVideo', videoId)
  const [videoResponse, playerResponse, likeCounts] = await Promise.all([
    fetchVideo(videoId),
    fetchPlayer(videoId),
    fetchVideoLikeCounts(videoId),
  ])

  const contents = videoResponse.contents.twoColumnWatchNextResults.results.results.contents
  const primaryInfo = findRendererRaw('videoPrimaryInfo')(contents)
  const secondaryInfo = findRendererRaw('videoSecondaryInfo')(contents)
  if (!primaryInfo || !secondaryInfo) {
    throw Error('Failed to find primary and secondary info in the YT request')
  }

  const video = processFullVideo(
    videoId,
    [primaryInfo, secondaryInfo],
    playerResponse.videoDetails,
    likeCounts.likes,
    likeCounts.dislikes,
  )

  const relatedVideos = findRenderer('itemSection')(
    videoResponse.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results,
  )!.contents

  const relatedVideosIterator = makeContinuationIterator(
    async () => relatedVideos,
    (token) => fetchCompactVideoContinuation(token).then(getContinuationResponseItems),
  )

  console.log(video)

  return {
    ...video,
    related: async function* (): AsyncGenerator<std.Video[]> {
      for await (const relatedVideos of relatedVideosIterator) {
        // todo: handle compactPlaylistRenderer
        yield relatedVideos.map(processRelatedItem).filter((video): video is std.Video => video !== undefined)
      }
    },
  }
}

export async function getPlayer(videoId: string) {
  const [player, segments] = await Promise.all([
    fetchPlayer(videoId).then(processPlayer),
    // SponsorBlock is a non-essential third party; never let it block playback.
    fetchSponsorBlock(videoId).catch(() => []),
  ])
  return { ...player, segments }
}

export const setVideoLikeStatus = async (
  videoId: string,
  currentLikeStatus: std.LikeStatus,
  likeStatus: std.LikeStatus,
) => fetchSetVideoLikeStatus(videoId, currentLikeStatus, likeStatus)

export function getVideoType(video: {
  badges?: MetadataBadge[]
  thumbnailOverlays?: ThumbnailOverlays[]
}): std.VideoType {
  const isLive = video.badges?.some(isLiveBadge) || video.thumbnailOverlays?.some(isLiveThumbnailOverlay)
  return isLive ? std.VideoType.Live : std.VideoType.Static
}
