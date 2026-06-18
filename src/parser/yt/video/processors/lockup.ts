import * as std from '@std'
import { ProviderName, VideoType, verifiedFrom } from '@std'
import { durationTextToSeconds, fromShortHumanReadable } from '@yt/core/helpers'
import { parseDate } from './helpers'

// YouTube replaced `videoRenderer` with this view-model shape in the home feed.
// We read only the fields heimdall renders, and optional-chain everything so a
// single malformed item degrades to a skip rather than blanking the whole grid.
type LockupImage = { sources?: std.Image[] }
type LockupText = { content?: string }
type MetadataPart = { text?: LockupText }
type MetadataRow = { metadataParts?: MetadataPart[] }

export type LockupViewModel = {
  contentId?: string
  contentType?: string
  contentImage?: {
    thumbnailViewModel?: {
      image?: LockupImage
      overlays?: {
        thumbnailBottomOverlayViewModel?: { badges?: { thumbnailBadgeViewModel?: { text?: string } }[] }
      }[]
    }
  }
  metadata?: {
    lockupMetadataViewModel?: {
      title?: LockupText
      image?: {
        decoratedAvatarViewModel?: {
          avatar?: { avatarViewModel?: { image?: LockupImage } }
          rendererContext?: {
            commandContext?: { onTap?: { innertubeCommand?: { browseEndpoint?: { browseId?: string } } } }
          }
        }
      }
      metadata?: { contentMetadataViewModel?: { metadataRows?: MetadataRow[] } }
    }
  }
}

const DURATION = /^(\d+:)?\d{1,2}:\d{2}$/

const tryOr = <T>(get: () => T): T | undefined => {
  try {
    return get()
  } catch {
    return undefined
  }
}

export const isLockupVideo = (lockup: LockupViewModel): boolean =>
  lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && typeof lockup.contentId === 'string'

export const processLockupVideo = (lockup: LockupViewModel): std.Video => {
  const meta = lockup.metadata?.lockupMetadataViewModel
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows ?? []
  const texts = rows
    .flatMap((row) => row.metadataParts ?? [])
    .map((part) => part.text?.content)
    .filter((text): text is string => !!text)

  const badges = (lockup.contentImage?.thumbnailViewModel?.overlays ?? [])
    .flatMap((overlay) => overlay.thumbnailBottomOverlayViewModel?.badges ?? [])
    .map((badge) => badge.thumbnailBadgeViewModel?.text)
    .filter((text): text is string => !!text)
  const durationText = badges.find((text) => DURATION.test(text))

  const avatar = meta?.image?.decoratedAvatarViewModel
  const channelName = rows[0]?.metadataParts?.[0]?.text?.content
  const channelId = avatar?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId

  const viewText = texts.find((text) => /\bviews?\b|watching/i.test(text))
  const dateText = texts.find((text) => /(ago|streamed|premiered)/i.test(text))

  return {
    provider: ProviderName.YT,
    type: badges.some((text) => /^live$/i.test(text)) ? VideoType.Live : VideoType.Static,
    id: lockup.contentId!,
    title: meta?.title?.content ?? '',
    viewCount: viewText ? tryOr(() => fromShortHumanReadable(viewText)) : undefined,
    author:
      channelName && channelId
        ? {
            name: channelName,
            id: channelId,
            avatar: avatar?.avatar?.avatarViewModel?.image?.sources,
            verified: verifiedFrom(false),
          }
        : undefined,
    staticThumbnail: lockup.contentImage?.thumbnailViewModel?.image?.sources ?? [],
    length: durationText ? durationTextToSeconds(durationText) : undefined,
    publishDate: dateText ? tryOr(() => parseDate(dateText)) : undefined,
  }
}
