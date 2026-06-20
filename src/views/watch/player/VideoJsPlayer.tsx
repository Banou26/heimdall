import '@videojs/react/video/skin.css'
import styled from 'styled-components'
import { createPlayer } from '@videojs/react'
import { VideoSkin, videoFeatures } from '@videojs/react/video'
import { ShakaVideo } from './sabr/ShakaVideo'

const Player = createPlayer({ features: videoFeatures })

const PlayerContainer = styled.div`
  width: 100%;
  background: black;
  /* aspect-ratio on a flex item doesn't drive height, so size the <video>
     itself - the box must have real dimensions or the browser won't decode it. */
  & video {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    background: black;
  }
`

// SABR playback: Video.js owns the UI, Shaka owns the MSE timeline (so seeking
// works), and the googlevideo adapter drives YouTube's Server-ABR protocol over
// the FKN extension. `videoId` is the YouTube id - ShakaMedia builds everything
// else from the InnerTube player response.
export const VideoJsPlayer = ({ videoId }: { videoId: string }) => (
  <PlayerContainer>
    <Player.Provider>
      <VideoSkin>
        <ShakaVideo src={videoId} />
      </VideoSkin>
    </Player.Provider>
  </PlayerContainer>
)
