import { IconCheck, IconSettingsFilled } from '@tabler/icons-react'
import { useContext } from 'react'
import * as std from '@std'
import { Menu } from '@mantine/core'

import { PlayerContext } from '../context'
import { useSource } from '../hooks/use'
import { AUTO_QUALITY, type CombinedSource } from '../hooks/usePlayerInstance'
import { ControlButton } from '../components/ControlButton'

// Quality is driven by shaka variant tracks (reshaped into std.Source by the
// adapter). Picking a height pins that variant (ABR off); "Auto" hands back to
// shaka's ABR (which respects restrictToElementSize). The adapter's source
// listener does the actual shaka selectVariantTrack / abr toggle.
export const Quality: React.FC = () => {
  const playerInstance = useContext(PlayerContext)
  const { source: selectedSource, sources, setSource } = useSource(playerInstance!)
  const auto = !!(selectedSource?.video as { __auto?: boolean } | undefined)?.__auto
  const selectedHeight = auto ? undefined : selectedSource?.video.height
  const videoSources = sources.filter(std.isVideoSource)
  const select = (video: CombinedSource['video']) =>
    setSource({ video, audio: video as unknown as CombinedSource['audio'] })

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
          onClick={() => select(AUTO_QUALITY as unknown as CombinedSource['video'])}
        >
          Auto
        </Menu.Item>
        {videoSources.map((source) => (
          <Menu.Item
            key={source.height}
            leftSection={
              <IconCheck size={16} style={{ opacity: Number(selectedHeight === source.height) }} />
            }
            onClick={() => select(source)}
          >
            {source.height}p{source.frameRate > 30 ? Math.round(source.frameRate) : ''}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
