import styled from 'styled-components'
import { useEffect, useMemo } from 'react'

import { useAsync } from '@/hooks/useAsync'
import { getPlayer, getVideo } from '@yt/video'
import { WatchInfo } from './WatchInfo'
import { VideoJsPlayer } from './player/VideoJsPlayer'

const WatchContainer = styled.main`
  display: flex;
  flex-direction: column;
  & > * + * {
    margin-top: 16px;
  }
`

export default function Watch({ params: { videoId } }: { params: { videoId: string } }) {
  const { data: video, error: videoError } = useAsync(() => getVideo(videoId), [videoId])
  const { data: player, error: playerError } = useAsync(() => getPlayer(videoId), [videoId])
  useEffect(() => {
    if (videoError) console.error(videoError)
    if (playerError) console.error(playerError)
  }, [videoError, playerError])

  // The video.js player consumes the DASH manifest as a blob URL.
  const manifestUrl = useMemo(() => {
    if (!player?.dashManifest) return undefined
    return URL.createObjectURL(new Blob([player.dashManifest], { type: 'application/dash+xml' }))
  }, [player?.dashManifest])
  useEffect(() => () => void (manifestUrl && URL.revokeObjectURL(manifestUrl)), [manifestUrl])

  return (
    <WatchContainer>
      {manifestUrl && <VideoJsPlayer src={manifestUrl} />}
      <WatchInfo video={video} />
    </WatchContainer>
  )
}
