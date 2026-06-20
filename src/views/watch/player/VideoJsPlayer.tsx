import { createPlayer } from '@videojs/react'
import { videoFeatures } from '@videojs/react/video'

import { Player } from './Player'
import type { PlayerInstance } from './hooks/usePlayerInstance'

const VideoPlayer = createPlayer({ features: videoFeatures })

// SABR playback hosted in @videojs/react v10: the Provider + ShakaVideo own the
// media engine (Shaka MSE timeline + the googlevideo SABR adapter over the FKN
// extension), while heimdall's own custom control UI (`Player`) replaces the
// default skin. The built PlayerInstance is lifted to Watch via onInstance.
export const VideoJsPlayer = ({
  videoId,
  onInstance,
}: {
  videoId: string
  onInstance: (instance?: PlayerInstance) => void
}) => (
  <VideoPlayer.Provider>
    <Player videoId={videoId} onInstance={onInstance} />
  </VideoPlayer.Provider>
)
