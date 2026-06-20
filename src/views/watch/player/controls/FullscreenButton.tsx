import { IconMaximize, IconMinimize } from '@tabler/icons-react'
import { ControlButton } from '../components/ControlButton'
import { useIsFullscreen } from '@/hooks/useIsFullscreen'

// playerRoot is accepted for Controls' call signature but unused: fullscreen is
// document-level (useIsFullscreen toggles documentElement), not per-element.
export const FullscreenButton: FC<{ playerRoot?: unknown }> = () => {
  const { isFullscreen, toggle } = useIsFullscreen()
  const Icon = isFullscreen ? IconMinimize : IconMaximize
  return (
    <ControlButton onClick={toggle}>
      <Icon />
    </ControlButton>
  )
}
