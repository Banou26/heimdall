import { memoizeAsync } from '@libs/cache'
import { removeRequestHeaderRule, setRequestHeaderRule } from '@libs/extension'

// <img>/<video> subresources never pass through fetchProxy, so a tab-scoped extension
// rule forges the youtube.com Origin/Referer their CDNs require.
const MEDIA_DOMAINS = ['yt3.ggpht.com', 'i.ytimg.com', 'googlevideo.com']

// sessionStorage shares the tab-scoped rule's exact lifetime, so the stored id always
// matches a rule that still exists; drop it before adding a fresh one.
const RULE_ID_KEY = 'heimdall:mediaHeaderRuleId'

export const setDeclarativeNetRequestHeaderRule = memoizeAsync(async () => {
  const previous = sessionStorage.getItem(RULE_ID_KEY)
  if (previous) await removeRequestHeaderRule(Number(previous)).catch(() => {})

  const { ruleId } = await setRequestHeaderRule({
    domains: MEDIA_DOMAINS,
    requestHeaders: [
      { header: 'Origin', operation: 'set', value: 'https://www.youtube.com' },
      { header: 'Referer', operation: 'set', value: 'https://www.youtube.com' },
    ],
    reason: 'Load YouTube thumbnails and video streams without hotlink errors',
  })
  sessionStorage.setItem(RULE_ID_KEY, String(ruleId))
})
