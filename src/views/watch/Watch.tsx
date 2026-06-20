import styled from 'styled-components'
import { useEffect } from 'react'

import { useAsync } from '@/hooks/useAsync'
import { getVideo } from '@yt/video'
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
  useEffect(() => {
    if (videoError) console.error(videoError)
  }, [videoError])

  return (
    <WatchContainer>
      <VideoJsPlayer key={videoId} videoId={videoId} />
      <WatchInfo video={video} />
    </WatchContainer>
  )
}
