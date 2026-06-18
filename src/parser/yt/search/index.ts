import * as std from '@std'
import { processChannel } from '@yt/channel/processors/channel'
import { processVideo } from '@yt/video/processors/regular'
import { fetchSearchIterator, fetchSearchSuggestions } from './api'
import type { SearchItem } from './types'

type ClassifiedItem = { type: std.ResourceType; resource: std.Resource<std.ResourceType> }

// Search results mix videos and channels with ads, promoted results and
// shelves (adSlotRenderer, searchPyvRenderer, gridShelfViewModel, …). Only
// surface the renderers we understand and never throw on the rest, so one odd
// item can't take down the whole list (and trigger an infinite retry storm).
const classifySearchItem = (item: SearchItem): ClassifiedItem | undefined => {
  try {
    if ('videoRenderer' in item) return { type: std.ResourceType.Video, resource: processVideo(item) }
    if ('channelRenderer' in item) return { type: std.ResourceType.Channel, resource: processChannel(item) }
  } catch (error) {
    console.warn('Failed to process search item', error)
  }
  return undefined
}

// TODO: Refactor
export const listSearch = <
  Type extends std.ResourceType.Channel | std.ResourceType.Playlist | std.ResourceType.Video,
>(
  resourceTypes: Type[],
) =>
  async function* (query: string): AsyncGenerator<std.Resource<Type>[]> {
    for await (const sectionList of fetchSearchIterator(query)) {
      const results = sectionList[0].itemSectionRenderer.contents
      /**
       * TODO: Youtube sometimes returns shelves with many items that is collapsed by default.
       * For now, we'll just return however items are shown when collapsed but we should enable showing
       * all items at some point
       */
      const items = results.flatMap((item) =>
        'shelfRenderer' in item
          ? item.shelfRenderer.content.verticalListRenderer.items.slice(
              0,
              item.shelfRenderer.content.verticalListRenderer.collapsedItemCount,
            )
          : item,
      )

      // TODO: Playlists?
      yield items
        .map(classifySearchItem)
        .filter(
          (entry): entry is ClassifiedItem =>
            entry !== undefined && resourceTypes.includes(entry.type as Type),
        )
        .map((entry) => entry.resource) as std.Resource<Type>[]
    }
  }

export const listSearchSuggestions = (_: std.ResourceType[]) => (query: string) =>
  fetchSearchSuggestions(query).then((res) => res[1].map((suggestion) => suggestion[0]))
