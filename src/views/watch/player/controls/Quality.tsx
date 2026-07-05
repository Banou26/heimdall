import { IconCheck, IconSettingsFilled } from '@tabler/icons-react'
import { useContext } from 'react'
import * as std from '@std'
import { Menu } from '@mantine/core'

import { PlayerContext } from '../context'
import { useSource } from '../hooks/use'
import { ControlButton } from '../components/ControlButton'

// Quality is driven by shaka variant tracks (reshaped into std.Source by the
// adapter). Picking a height pins that variant (ABR off); "Auto" hands back to
// shaka's ABR (which respects restrictToElementSize). The adapter's source
// listener does the actual shaka selectVariantTrack / abr toggle.
export const Quality: React.FC = () => {
  const playerInstance = useContext(PlayerContext)
  const { source: selectedSource, sources, setSource } = useSource(playerInstance!)
  const auto = selectedSource?.mode === 'auto'
  const selectedHeight = selectedSource?.mode === 'manual' ? selectedSource.video.height : undefined
  const videoSources = sources.filter(std.isVideoSource)

  return (
    <Menu position="top" closeOnItemClick={false}>
      <Menu.Target>
        <ControlButton>
          <IconSettingsFilled />
        </ControlButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Quality</Menu.Label>
        <Menu.Item
          leftSection={<IconCheck size={16} style={{ opacity: Number(auto) }} />}
          onClick={() => setSource({ mode: 'auto' })}
        >
          Auto
        </Menu.Item>
        {videoSources.map((source) => (
          <Menu.Item
            key={source.height}
            leftSection={
              <IconCheck size={16} style={{ opacity: Number(selectedHeight === source.height) }} />
            }
            onClick={() => setSource({ mode: 'manual', video: source })}
          >
            {source.height}p{source.frameRate > 30 ? Math.round(source.frameRate) : ''}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
