import * as std from '@std'
import { fetchChannelHome } from '../api'
import { fromShortHumanReadable } from '../../core/helpers'

// YouTube replaced `c4TabbedHeaderRenderer` with `pageHeaderViewModel`. The stable
// `channelMetadataRenderer` still carries name/avatar/description, so we build from
// that and enrich with whatever the new header exposes, never throwing on a field
// the new format moved or dropped (verified badge / follow state are not yet wired).
type PageHeaderViewModel = {
  metadata?: {
    contentMetadataViewModel?: { metadataRows?: { metadataParts?: { text?: { content?: string } }[] }[] }
  }
  banner?: { imageBannerViewModel?: { image?: { sources?: std.Image[] } } }
}

export const processChannelPage = async (channelId: string): Promise<std.Channel> => {
  const channelResponse = await fetchChannelHome(channelId)
  const metadata = channelResponse.metadata.channelMetadataRenderer
  const header = (
    channelResponse.header as {
      pageHeaderRenderer?: { content?: { pageHeaderViewModel?: PageHeaderViewModel } }
    }
  )?.pageHeaderRenderer?.content?.pageHeaderViewModel

  const headerTexts = (header?.metadata?.contentMetadataViewModel?.metadataRows ?? [])
    .flatMap((row) => row.metadataParts ?? [])
    .map((part) => part.text?.content)
    .filter((text): text is string => !!text)
  const subscriberText = headerTexts.find((text) => /subscriber/i.test(text))

  let followerCount: number | undefined
  try {
    followerCount = subscriberText ? fromShortHumanReadable(subscriberText) : undefined
  } catch {
    followerCount = undefined
  }

  return {
    provider: std.ProviderName.YT,
    id: channelId,
    user: {
      avatar: metadata.avatar.thumbnails,
      id: channelId,
      name: metadata.title,
      followerCount,
    },
    banner: header?.banner?.imageBannerViewModel?.image?.sources,
    description: [{ content: metadata.description, type: std.RichTextChunkType.Text }],
  }
}
