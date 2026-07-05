import { forwardRef } from 'react'
import type { ReactNode, Ref } from 'react'
import { useAttachMedia, useComposedRefs, useMediaInstance } from '@videojs/react'
import { ShakaMedia, shakaMediaDefaultProps } from './ShakaMedia'

// useSyncProps isn't a public @videojs/react export; inline the same behaviour -
// assign known props to the media instance, pass the rest through to the <video>.
const syncProps = (
  target: Record<string, unknown>,
  props: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> => {
  const rest: Record<string, unknown> = {}
  for (const key in props) {
    if (key in defaults) {
      const value = props[key] === undefined ? defaults[key] : props[key]
      if (target[key] !== value) target[key] = value
    } else {
      rest[key] = props[key]
    }
  }
  return rest
}

type ShakaVideoProps = { src: string; startTime?: number; children?: ReactNode }

// A Video.js media-engine provider backed by ShakaMedia (Shaka Player + the
// googlevideo SABR adapter). Unlike <DashVideo>, `src` is a YouTube videoId -
// ShakaMedia fetches the player response and builds the SABR manifest itself.
export const ShakaVideo = forwardRef(function ShakaVideo(
  { children, ...props }: ShakaVideoProps,
  ref: Ref<HTMLVideoElement>,
) {
  const media = useMediaInstance(ShakaMedia as never)
  return (
    <video
      ref={useComposedRefs(useAttachMedia(media), ref)}
      {...syncProps(media as never, props, shakaMediaDefaultProps)}
    >
      {children}
    </video>
  )
})
