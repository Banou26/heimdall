import * as std from '@std'
import type { HorizontalList, Shelf } from '../../components/core'
import { type GridVideo, processGridVideo } from '../../video/processors/grid'
import { type LockupViewModel, isLockupVideo, processLockupVideo } from '../../video/processors/lockup'
import { combineSomeText } from '../../components/text'
import { getBrowseEndpointUrl } from '../../components/utility/endpoint'
import type { GridChannel } from '../types'
import { isRenderer } from '../../core/internals'
import { processGridChannel } from './grid'
import { processGridPlaylist } from '../../playlist/processors/grid'

export const processShelf = ({
  shelfRenderer: shelf,
}: Shelf<HorizontalList<GridVideo> | HorizontalList<GridChannel>>): std.Shelf<
  std.ShelfType.Videos | std.ShelfType.Channels | std.ShelfType.Playlists
> => {
  const items = shelf.content.horizontalListRenderer.items
  const isChannel = items.some(isRenderer('gridChannel'))
  const isPlaylist = items.some(isRenderer('gridPlaylist'))
  // Videos are the default: legacy gridVideo and the newer lockupViewModel.

  return {
    provider: std.ProviderName.YT,
    type: isChannel ? std.ShelfType.Channels : isPlaylist ? std.ShelfType.Playlists : std.ShelfType.Videos,
    name: combineSomeText(shelf.title),
    shortDescription: shelf.subtitle && combineSomeText(shelf.subtitle),
    href: shelf.navigationEndpoint && getBrowseEndpointUrl(shelf.navigationEndpoint),
    items: shelf.content.horizontalListRenderer.items
      .map((renderer) => {
        try {
          if (isRenderer('gridVideo')(renderer)) return processGridVideo(renderer)
          if (isRenderer('gridChannel')(renderer)) return processGridChannel(renderer)
          if (isRenderer('gridPlaylist')(renderer)) return processGridPlaylist(renderer)
          const lockup = (renderer as { lockupViewModel?: LockupViewModel }).lockupViewModel
          if (lockup && isLockupVideo(lockup)) return processLockupVideo(lockup)
          console.warn(`Unknown renderer type "${Object.keys(renderer)[0]}" in shelf... ignoring`)
        } catch (error) {
          console.warn('Failed to process shelf item', error)
        }
      })
      .filter((item): item is std.Video | std.Channel | std.Playlist => Boolean(item)),
  }
}
