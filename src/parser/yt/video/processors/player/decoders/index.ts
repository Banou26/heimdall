import { getNonce } from '../../../api'
import { getDecodedNParam } from './n'
import { getDecodedSigParam } from './signature'

export async function decodeVideoPlaybackUrl(url: URL, videoId: string): Promise<URL> {
  const urlQueryParams = new URLSearchParams(url.search)
  // The IOS client (and others) return ready-to-play URLs with no `n` param to
  // decode; use them as-is rather than running the JS-player transforms.
  if (!urlQueryParams.has('n')) return url
  const decodedNParam = await getDecodedNParam(urlQueryParams.get('n')!)
  urlQueryParams.set('n', decodedNParam)

  if (urlQueryParams.get('alr') === 'yes' && urlQueryParams.has('sig')) {
    urlQueryParams.set('sig', await getDecodedSigParam(urlQueryParams.get('sig')!))
  }

  urlQueryParams.set('cpn', getNonce(videoId))

  const decodedUrl = new URL(url)
  decodedUrl.search = urlQueryParams.toString()
  return decodedUrl
}
