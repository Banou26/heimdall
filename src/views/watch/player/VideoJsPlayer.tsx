import '@videojs/react/video/skin.css'
import styled from 'styled-components'
import { createPlayer } from '@videojs/react'
import { VideoSkin, videoFeatures } from '@videojs/react/video'
import { DashVideo } from '@videojs/react/media/dash-video'
import { installMediaFetchProxy } from '@libs/media-proxy'

// dash.js (under <DashVideo>) fetches segments from googlevideo, which has no
// CORS - route those through the FKN extension. Installed once, on import.
installMediaFetchProxy()

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

// `src` is a blob: URL of a DASH manifest built from the YouTube IOS formats.
export const VideoJsPlayer = ({ src }: { src: string }) => (
  <PlayerContainer>
    <Player.Provider>
      <VideoSkin>
        <DashVideo src={src} />
      </VideoSkin>
    </Player.Provider>
  </PlayerContainer>
)
