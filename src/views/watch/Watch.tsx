import styled from 'styled-components'
import { useEffect, useMemo, useState } from 'react'
import { useSearch } from 'wouter'

import { useAsync } from '@/hooks/useAsync'
import { getVideo } from '@yt/video'
import { WatchInfo } from './WatchInfo'
import { VideoJsPlayer } from './player/VideoJsPlayer'
import { PlayerContext } from './player/context'
import type { PlayerInstance } from './player/hooks/usePlayerInstance'

const WatchContainer = styled.main`
  display: flex;
  flex-direction: column;
  & > * + * {
    margin-top: 16px;
  }
`

export default function Watch({ params: { videoId } }: { params: { videoId: string } }) {
  const { data: video, error: videoError } = useAsync(() => getVideo(videoId), [videoId])
  const search = useSearch()
  const startTime = useMemo(() => {
    const t = Number.parseInt(new URLSearchParams(search).get('t') ?? '')
    return Number.isNaN(t) ? undefined : t
  }, [search])
  // The player builds its adapter inside <Player.Provider>; lift it here so both
  // the player UI and WatchInfo (copy-link-at-timestamp) share one PlayerContext.
  const [instance, setInstance] = useState<PlayerInstance>()
  useEffect(() => {
    if (videoError) console.error(videoError)
  }, [videoError])
  useEffect(() => {
    if (startTime !== undefined) instance?.seekMS.set(startTime * 1000)
  }, [instance, startTime])

  return (
    <PlayerContext.Provider value={instance}>
      <WatchContainer>
        <VideoJsPlayer key={videoId} videoId={videoId} startTime={startTime} onInstance={setInstance} />
        <WatchInfo video={video} />
      </WatchContainer>
    </PlayerContext.Provider>
  )
}
