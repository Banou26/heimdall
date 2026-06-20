// The self-contained bgutils CJS bundle (no requires), inlined as text so it can run in
// the youtube.com frame's MAIN world - the only realm where YouTube's BotGuard VM emits
// signals + a minter (heimdall's own origin yields 0 signals under any environment).
import bgutilsBundle from '../../node_modules/bgutils-js/bundle/index.cjs?raw'
import { buildURL, GOOG_API_KEY } from 'bgutils-js'

import { fetchProxy, attachFrame } from '@libs/extension'

type Frame = Awaited<ReturnType<typeof attachFrame>>
type Ctx = { client: { visitorData: string; clientVersion: string } }

// PO Token (BotGuard / WebPO) minting. YouTube gates SABR streaming behind a
// proof-of-origin token. The crucial detail (per FreeTube's src/botGuardScript.js):
// the challenge MUST come from the SESSION-BOUND /youtubei/v1/att/get endpoint (carrying
// this session's visitorData + context), NOT the generic Create endpoint - a token from
// a generic challenge gets the ~60s preview cap. The VM snapshot + the mint run in the
// frame; the network hops (att/get, interpreter, GenerateIT) run here through the proxy.
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const IT_HEADERS = {
  'content-type': 'application/json+protobuf',
  'x-goog-api-key': GOOG_API_KEY,
  'x-user-agent': 'grpc-web-javascript/0.1',
}
const YT_DOMAINS = ['www.youtube.com', 'youtube.com']
const YT_BOOTSTRAP_URL = 'https://www.youtube.com/embed/dQw4w9WgXcQ'
const ATT_GET_URL = 'https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false&alt=json'

const isCookieless = () => !!(globalThis as Record<string, unknown>).__sabrCookieless

// Runs in the frame's MAIN world (concatenated, not template-interpolated, so the
// bundle's own backticks can't break it). Wraps the CJS bundle, then exposes a tiny
// minter API on the frame's window; state persists between evaluate() calls.
const PAYLOAD_SETUP =
  '() => {' +
  '  const m = { exports: {} };' +
  '  (function (module, exports) {\n' +
  bgutilsBundle +
  '\n})(m, m.exports);' +
  '  const ns = m.exports;' +
  '  const BG = ns.default ?? ns.BG ?? ns;' +
  '  const state = {};' +
  '  globalThis.__fknYtMinter = {' +
  '    async snapshot(a) {' +
  '      const el = document.createElement("script"); el.textContent = a[0];' +
  '      (document.head || document.documentElement).appendChild(el);' +
  '      const client = await BG.BotGuardClient.create({ globalObj: globalThis, globalName: a[2], program: a[1] });' +
  '      const webPoSignalOutput = [];' +
  '      const botguardResponse = await client.snapshot({ webPoSignalOutput });' +
  '      state.webPoSignalOutput = webPoSignalOutput;' +
  '      return { botguardResponse, signals: webPoSignalOutput.length };' +
  '    },' +
  '    async createMinter(integrityTokenData) {' +
  '      state.minter = await BG.WebPoMinter.create(integrityTokenData, state.webPoSignalOutput);' +
  '    },' +
  '    mint(identifier) { return state.minter.mintAsWebsafeString(identifier); },' +
  '  };' +
  '}'

type Session = { frame: Frame; expiresAt: number }

let session: Session | undefined
let pending: Promise<Session> | undefined

const openFrame = async (): Promise<Frame> => {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  Object.assign(iframe.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
    visibility: 'hidden',
  })
  document.body.appendChild(iframe)

  const frame = await attachFrame({ iframe, domains: YT_DOMAINS, syncCookies: false, lockdown: false })
  await frame.goto(YT_BOOTSTRAP_URL)
  await frame.evaluate(PAYLOAD_SETUP)
  return frame
}

// Session-bound BotGuard challenge from /att/get (the interpreter is at a URL, fetched
// separately). Both hops run in the app through the proxy; the frame can't reach network.
const fetchChallenge = async (context: unknown): Promise<[string, string, string]> => {
  const ctx = context as Ctx
  const res = await fetchProxy(ATT_GET_URL, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
      'X-Goog-Visitor-Id': ctx.client.visitorData,
      'X-Youtube-Client-Version': ctx.client.clientVersion,
      'X-Youtube-Client-Name': '1',
    },
    body: JSON.stringify({ engagementType: 'ENGAGEMENT_TYPE_UNBOUND', context }),
    credentials: isCookieless() ? 'omit' : 'include',
  })
  const data = (await res.json()) as {
    bgChallenge?: {
      program: string
      globalName: string
      interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string }
    }
  }
  const bg = data.bgChallenge
  if (!bg) throw new Error('botguard: no bgChallenge from /att/get')
  let interpreterUrl = bg.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  if (!interpreterUrl) throw new Error('botguard: no interpreterUrl')
  if (interpreterUrl.startsWith('//')) interpreterUrl = `https:${interpreterUrl}`
  const interpreterJs = await fetchProxy(interpreterUrl, { credentials: 'omit' }).then((r) => r.text())
  if (!interpreterJs) throw new Error('botguard: empty interpreter')
  return [interpreterJs, bg.program, bg.globalName]
}

const buildSession = async (context: unknown): Promise<Session> => {
  const frame = await openFrame()
  const challenge = await fetchChallenge(context)
  const { botguardResponse, signals } = (await frame.evaluate(
    '(a) => __fknYtMinter.snapshot(a)',
    challenge,
  )) as { botguardResponse: string; signals: number }
  const it = (await fetchProxy(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: IT_HEADERS,
    credentials: 'omit',
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  }).then((res) => res.json())) as [string | null, number, number | null, string]
  if (!it[0] && !it[3]) throw new Error(`botguard: no integrity token (signals ${signals})`)
  await frame.evaluate('(a) => __fknYtMinter.createMinter(a)', {
    integrityToken: it[0] ?? undefined,
    estimatedTtlSecs: it[1],
    mintRefreshThreshold: it[2] ?? undefined,
    websafeFallbackToken: it[3],
  })
  // Refresh at 80% of the integrity token's lifetime.
  return { frame, expiresAt: performance.now() + (Number(it[1]) || 3600) * 800 }
}

const getSession = (context: unknown): Promise<Session> => {
  if (session && performance.now() < session.expiresAt) return Promise.resolve(session)
  pending ??= buildSession(context)
    .then((s) => {
      session = s
      pending = undefined
      return s
    })
    .catch((error) => {
      pending = undefined
      throw error
    })
  return pending
}

// Mint a WebPO token bound to `identifier` (the videoId for content + GVS tokens).
export const mintPoToken = async (identifier: string, context: unknown): Promise<string> => {
  const { frame } = await getSession(context)
  return frame.evaluate('(a) => __fknYtMinter.mint(a)', identifier)
}
