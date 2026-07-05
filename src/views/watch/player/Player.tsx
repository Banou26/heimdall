import type React from 'react'
import { useContext, useEffect } from 'react'
import styled from 'styled-components'

import { LoadingOverlay, Text } from '@mantine/core'
import { useHover, useIdle } from '@mantine/hooks'

import { ShakaVideo } from './sabr/ShakaVideo'
import { PlayerContext } from './context'
import { Controls } from './Controls'
import { ClosedCaptions } from './ClosedCaptions'
import { Categories } from './Categories'
import { Tracking } from './Tracking'
import { PlayerState, useShakaPlayerInstance, type PlayerInstance } from './hooks/usePlayerInstance'
import { useBuffering, usePlayerState } from './hooks/use'
import { usePlayerHotkeys } from './hooks/usePlayerHotkeys'
import { useIsFullscreen } from '@/hooks/useIsFullscreen'
import useDoubleClick from '@/hooks/useDoubleClick'
import { useDelayedToggle } from '@/hooks/useDelayed'

const PlayerContainer = styled.div<{ $isFullscreen: boolean; $hideMouse: boolean }>`
  position: relative;
  background: black;
  ${({ $hideMouse }) => $hideMouse && 'cursor: none;'}

  video {
    display: block;
    width: 100%;
    height: ${({ $isFullscreen }) => ($isFullscreen ? '100vh' : 'auto')};
    max-height: ${({ $isFullscreen }) => ($isFullscreen ? '100vh' : '90vh')};
    aspect-ratio: 16 / 9;
    object-fit: contain;
    background-color: black;
  }
`

// Full-size transparent layer over the <video> that captures play/fullscreen
// clicks and hosts the controls; the video shows through, the controls sit at
// the bottom (and stop propagation so clicking them doesn't toggle playback).
const Overlay = styled.div`
  position: absolute;
  inset: 0;
`

const PlaybackError = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
`

// The player owns the v10/Shaka adapter (built via useMedia inside Player.Provider)
// and provides it on PlayerContext for the controls; it also lifts it to Watch (so
// WatchInfo can read the current time). ShakaVideo renders unconditionally - it's
// what creates the media the adapter wraps - and the controls overlay it once ready.
export const Player: React.FC<{
  videoId: string
  startTime?: number
  onInstance: (instance?: PlayerInstance) => void
}> = ({ videoId, startTime, onInstance }) => {
  const { instance, error } = useShakaPlayerInstance(videoId)
  useEffect(() => {
    onInstance(instance)
    return () => onInstance(undefined)
  }, [instance, onInstance])

  return (
    <PlayerContext.Provider value={instance}>
      <PlayerShell videoId={videoId} startTime={startTime} error={error} />
    </PlayerContext.Provider>
  )
}

const PlayerShell: React.FC<{ videoId: string; startTime?: number; error?: Error }> = ({
  videoId,
  startTime,
  error,
}) => {
  const instance = useContext(PlayerContext)
  const { isFullscreen } = useIsFullscreen()
  const idle = useIdle(1000, { events: ['mousemove'] })
  const { hovered, ref: playerRef } = useHover<HTMLDivElement>()

  return (
    <PlayerContainer ref={playerRef} $isFullscreen={isFullscreen} $hideMouse={idle && hovered && !!instance}>
      <ShakaVideo startTime={startTime} src={videoId} />
      {instance ? (
        <PlayerOverlay instance={instance} playerRoot={playerRef} mouseActive={hovered && !idle} />
      ) : error ? (
        <PlaybackError>
          <Text c="white" fw="bold" size="lg">
            Playback failed
          </Text>
          <Text c="dimmed">{error.message}</Text>
        </PlaybackError>
      ) : (
        <LoadingOverlay
          zIndex={1}
          loaderProps={{ color: 'white', size: 48 }}
          style={{ pointerEvents: 'none' }}
          visible
        />
      )}
    </PlayerContainer>
  )
}

const PlayerOverlay: React.FC<{
  instance: PlayerInstance
  playerRoot: React.RefObject<HTMLDivElement>
  mouseActive: boolean
}> = ({ instance, playerRoot, mouseActive }) => {
  const { state: playerState, togglePlay } = usePlayerState(instance)
  const { buffering } = useBuffering(instance)
  const showBuffering = useDelayedToggle(buffering, 400) && playerState === PlayerState.Playing
  const { toggle: toggleFullscreen } = useIsFullscreen()
  usePlayerHotkeys(playerRoot)

  const onClick = useDoubleClick({
    onEagerSingleClick: () => togglePlay(playerState),
    onDoubleClick: (triggeredEager) => {
      toggleFullscreen()
      if (triggeredEager) togglePlay(playerState)
    },
  })

  return (
    <Overlay onClick={onClick}>
      <Controls key="controls" mouseActive={mouseActive} playerRoot={playerRoot} />
      <LoadingOverlay
        zIndex={1}
        loaderProps={{ color: 'white', size: 48 }}
        style={{ pointerEvents: 'none' }}
        visible={showBuffering}
      />
      <ClosedCaptions />
      <Categories />
      <Tracking />
    </Overlay>
  )
}
