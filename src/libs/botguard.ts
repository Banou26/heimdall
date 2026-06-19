// The self-contained bgutils CJS bundle (no requires), inlined as text so it can run in
// the locked youtube.com frame's MAIN world - that is the only realm where YouTube's
// BotGuard VM emits a minter, and where the minter closure (which can't cross realms)
// lives. Imported raw, never executed in heimdall's own context.
import bgutilsBundle from '../../node_modules/bgutils-js/bundle/index.cjs?raw'
import { buildURL, GOOG_API_KEY } from 'bgutils-js'

import { fetchProxy, attachFrame } from '@libs/extension'

type Frame = Awaited<ReturnType<typeof attachFrame>>

// PO Token (BotGuard / WebPO) minting. YouTube gates SABR streaming behind a
// proof-of-origin token. The token can only be produced on a real youtube.com origin,
// so we run the BotGuard VM + the minter inside a hidden, cookieless, network-locked
// youtube.com frame (extension `lockdown`): the frame can run our payload + eval but
// cannot fetch or read its own origin's data. The two network hops it would otherwise
// need (Create / GenerateIT) run here, in the app, through the extension proxy; only the
// VM snapshot and the mint - neither of which touch the network - happen in the frame.
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const HEADERS = {
  'content-type': 'application/json+protobuf',
  'x-goog-api-key': GOOG_API_KEY,
  'x-user-agent': 'grpc-web-javascript/0.1',
}
const YT_DOMAINS = ['www.youtube.com', 'youtube.com']
const YT_BOOTSTRAP_URL = 'https://www.youtube.com/embed/dQw4w9WgXcQ'

// Runs in the frame's MAIN world (concatenated, not template-interpolated, so the
// bundle's own backticks can't break it). Wraps the CJS bundle, then exposes a tiny
// minter API on the frame's window; state persists between evaluate() calls.
const PAYLOAD_SETUP =
  '() => {' +
  '  const m = { exports: {} };' +
  '  (function (module, exports) {\n' + bgutilsBundle + '\n})(m, m.exports);' +
  '  const ns = m.exports;' +
  '  const BG = ns.default ?? ns.BG ?? ns;' +
  '  const state = {};' +
  '  globalThis.__fknYtMinter = {' +
  '    async snapshot(challenge) {' +
  '      const c = BG.Challenge.parseChallengeData(challenge);' +
  '      if (!c) throw new Error("botguard: no challenge data");' +
  '      const script = c.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;' +
  '      if (!script) throw new Error("botguard: no interpreter script");' +
  '      (0, eval)(script);' +
  '      const client = await BG.BotGuardClient.create({ globalObj: globalThis, globalName: c.globalName, program: c.program });' +
  '      const webPoSignalOutput = [];' +
  '      const botguardResponse = await client.snapshot({ webPoSignalOutput });' +
  '      state.webPoSignalOutput = webPoSignalOutput;' +
  '      return botguardResponse;' +
  '    },' +
  '    async createMinter(integrityToken) {' +
  '      state.minter = await BG.WebPoMinter.create({ integrityToken }, state.webPoSignalOutput);' +
  '    },' +
  '    mint(identifier) { return state.minter.mintAsWebsafeString(identifier); },' +
  '  };' +
  '}'

type Session = { frame: Frame, expiresAt: number }

let session: Session | undefined
let pending: Promise<Session> | undefined

const post = (name: 'Create' | 'GenerateIT', body: unknown): Promise<unknown> =>
  fetchProxy(buildURL(name, true), {
    method: 'POST',
    headers: HEADERS,
    credentials: 'omit',
    body: JSON.stringify(body),
  }).then((res) => res.json())

const openFrame = async (): Promise<Frame> => {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  Object.assign(iframe.style, {
    position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
    border: '0', opacity: '0', pointerEvents: 'none', visibility: 'hidden',
  })
  document.body.appendChild(iframe)

  const frame = await attachFrame({ iframe, domains: YT_DOMAINS, syncCookies: false, lockdown: true })
  await frame.goto(YT_BOOTSTRAP_URL)
  await frame.evaluate(PAYLOAD_SETUP)
  return frame
}

const buildSession = async (): Promise<Session> => {
  const frame = await openFrame()
  const challenge = await post('Create', [REQUEST_KEY])
  const botguardResponse = await frame.evaluate('(a) => __fknYtMinter.snapshot(a)', challenge)
  const [integrityToken, ttlSecs] = (await post('GenerateIT', [REQUEST_KEY, botguardResponse])) as [string, number]
  await frame.evaluate('(a) => __fknYtMinter.createMinter(a)', integrityToken)
  // Refresh at 80% of the integrity token's lifetime.
  return { frame, expiresAt: performance.now() + (Number(ttlSecs) || 3600) * 800 }
}

const getSession = (): Promise<Session> => {
  if (session && performance.now() < session.expiresAt) return Promise.resolve(session)
  pending ??= buildSession()
    .then((s) => { session = s; pending = undefined; return s })
    .catch((error) => { pending = undefined; throw error })
  return pending
}

// Mint a WebPO token bound to `identifier` (the videoId for content + GVS tokens).
export const mintPoToken = async (identifier: string): Promise<string> => {
  const { frame } = await getSession()
  return frame.evaluate('(a) => __fknYtMinter.mint(a)', identifier)
}
