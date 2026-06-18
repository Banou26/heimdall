import { memoizeAsync } from '@libs/cache'
import { removeRequestHeaderRule, setRequestHeaderRule } from '@libs/extension'

// YouTube's image and video CDNs reject any request whose Origin/Referer isn't
// youtube.com. Those loads are <img>/<video> subresources of this page, so they
// never pass through fetchProxy - the FKN extension rewrites their headers with
// a persistent, tab-scoped rule instead.
const MEDIA_DOMAINS = ['yt3.ggpht.com', 'i.ytimg.com', 'googlevideo.com']

// The rule is tab-scoped and outlives reloads, so we remember its id to drop the
// previous one before adding a fresh one. sessionStorage is the right home: it
// shares the rule's exact lifetime (cleared when the tab closes, kept across
// reloads), so the id we read back always matches a rule that still exists.
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
