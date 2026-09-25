import { shell, net } from 'electron'
import log from 'electron-log/main'
import { ConfigDBManager } from '~/core/database'
import { BangumiTokenResult, BangumiTokenStatus } from '@appTypes/utils'
import { generateUUID } from '@appUtils'

/**
 * Bangumi credentials live in the local (unsynced) config: a token unlocks the user's own
 * NSFW-visible content, so it must never be pushed to the cloud.
 */
const CONFIG_PATH = 'game.scraper.bangumi' as const

/**
 * OAuth lives on bgm.tv while the API lives on api.bgm.tv. The two hosts are not
 * interchangeable — posting the token exchange to the API host fails.
 */
const AUTHORIZE_ENDPOINT = 'https://bgm.tv/oauth/authorize'
const TOKEN_ENDPOINT = 'https://bgm.tv/oauth/access_token'
const API_BASE = 'https://api.bgm.tv'

/** Where the user creates a personal access token by hand. */
const TOKEN_PAGE = 'https://next.bgm.tv/demo/access-token'

/** Must match the URL the app entry point routes back to us. */
export const BANGUMI_REDIRECT_URI = 'vnite://bgm/callback'

/**
 * Bangumi blocks generic user agents, so every request must carry this format:
 * `{developer_id}/{app_name}[/{version}] [({platform})] [({project_url})]`.
 */
export const BANGUMI_USER_AGENT = 'ximu3/vnite/4.0.0-alpha.0 (https://github.com/ximu3/vnite)'

/** Renew slightly early so a scrape in flight never lands on a token that just expired. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000

interface BangumiCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
  userName: string
}

function getOAuthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = import.meta.env.VITE_BANGUMI_CLIENT_ID || ''
  const clientSecret = import.meta.env.VITE_BANGUMI_CLIENT_SECRET || ''
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function emptyCredentials(): BangumiCredentials {
  return { accessToken: '', refreshToken: '', expiresAt: 0, userName: '' }
}

async function readCredentials(): Promise<BangumiCredentials> {
  const stored = await ConfigDBManager.getConfigLocalValue(CONFIG_PATH)
  return { ...emptyCredentials(), ...(stored || {}) }
}

async function writeCredentials(credentials: BangumiCredentials): Promise<void> {
  await ConfigDBManager.setConfigLocalValue(CONFIG_PATH, credentials)
}

/**
 * Resolve the account behind a token. Returns `null` only when Bangumi rejects it, which is what
 * lets the settings page refuse an expired or mistyped token instead of storing it silently.
 */
async function fetchBangumiUserName(accessToken: string): Promise<string | null> {
  try {
    const response = await net.fetch(`${API_BASE}/v0/me`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': BANGUMI_USER_AGENT,
        Authorization: `Bearer ${accessToken}`
      }
    })
    if (!response.ok) {
      log.warn(`[BangumiAuth] /v0/me rejected the token with status ${response.status}`)
      return null
    }
    const data = await response.json()
    return data?.nickname || data?.username || ''
  } catch (error) {
    log.warn('[BangumiAuth] Failed to reach /v0/me:', error)
    return null
  }
}

async function requestToken(
  params: URLSearchParams,
  fallbackUserName: string
): Promise<BangumiCredentials | null> {
  try {
    const response = await net.fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': BANGUMI_USER_AGENT
      },
      body: params.toString()
    })

    if (!response.ok) {
      log.error(`[BangumiAuth] Token endpoint returned ${response.status}`)
      return null
    }

    const data = await response.json()
    const accessToken: string = data?.access_token || ''
    if (!accessToken) {
      log.error('[BangumiAuth] Token endpoint returned no access_token')
      return null
    }

    const expiresIn = Number(data?.expires_in) || 0
    const userName = (await fetchBangumiUserName(accessToken)) ?? fallbackUserName

    return {
      accessToken,
      refreshToken: data?.refresh_token || '',
      expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
      userName
    }
  } catch (error) {
    log.error('[BangumiAuth] Token exchange failed:', error)
    return null
  }
}

/** Shared by concurrent scrapes so they trigger a single refresh instead of racing each other. */
let refreshInFlight: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async (): Promise<string | null> => {
    try {
      const credentials = await readCredentials()
      const client = getOAuthClient()
      if (!credentials.refreshToken || !client) return null

      const refreshed = await requestToken(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: client.clientId,
          client_secret: client.clientSecret,
          refresh_token: credentials.refreshToken,
          redirect_uri: BANGUMI_REDIRECT_URI
        }),
        credentials.userName
      )

      if (!refreshed) {
        log.warn('[BangumiAuth] Could not refresh the Bangumi token; signing in again is required')
        return null
      }

      await writeCredentials(refreshed)
      log.info('[BangumiAuth] Access token refreshed')
      return refreshed.accessToken
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

/**
 * The token every Bangumi request should use. Resolution order: stored token (silently renewed
 * through the refresh token once it has expired) → build-time key → none. An empty string is a
 * valid answer: the request then goes out anonymously, and only NSFW-restricted subjects 404.
 */
export async function getBangumiAccessToken(): Promise<string> {
  const credentials = await readCredentials()

  if (credentials.accessToken) {
    const neverExpires = credentials.expiresAt === 0
    const stillFresh = credentials.expiresAt - EXPIRY_SKEW_MS > Date.now()
    if (neverExpires || stillFresh) return credentials.accessToken

    const renewed = await refreshAccessToken()
    if (renewed) return renewed
  }

  return import.meta.env.VITE_BANGUMI_API_KEY || ''
}

export async function setBangumiManualToken(token: string): Promise<BangumiTokenResult> {
  const trimmed = token.trim()
  if (!trimmed) return { success: false, error: 'empty' }

  const userName = await fetchBangumiUserName(trimmed)
  if (userName === null) return { success: false, error: 'invalid' }

  await writeCredentials({
    accessToken: trimmed,
    // Personal tokens carry no refresh token, so a later expiry means "paste a new one".
    refreshToken: '',
    // Bangumi publishes a personal token's expiry only through an authenticated endpoint, so
    // treat it as unknown rather than guessing a date and discarding a token that still works.
    expiresAt: 0,
    userName
  })

  log.info(`[BangumiAuth] Personal token saved for ${userName || 'unknown user'}`)
  return { success: true, userName }
}

export async function clearBangumiToken(): Promise<void> {
  await writeCredentials(emptyCredentials())
  log.info('[BangumiAuth] Bangumi token cleared')
}

export async function getBangumiTokenStatus(): Promise<BangumiTokenStatus> {
  const credentials = await readCredentials()
  return {
    configured: !!credentials.accessToken,
    userName: credentials.userName,
    expiresAt: credentials.expiresAt,
    mode: credentials.accessToken ? (credentials.refreshToken ? 'oauth' : 'manual') : 'none',
    oauthAvailable: getOAuthClient() !== null
  }
}

export async function openBangumiTokenPage(): Promise<void> {
  await shell.openExternal(TOKEN_PAGE)
}

/** Guards the callback against a stale or forged redirect. */
let pendingOAuthState: string | null = null

export async function startBangumiOAuth(): Promise<BangumiTokenResult> {
  const client = getOAuthClient()
  if (!client) return { success: false, error: 'oauth-unavailable' }

  // `scope` is documented by Bangumi but not implemented server-side, so it is left out.
  const state = generateUUID()
  pendingOAuthState = state

  const url = new URL(AUTHORIZE_ENDPOINT)
  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', BANGUMI_REDIRECT_URI)
  url.searchParams.set('state', state)

  await shell.openExternal(url.toString())
  log.info('[BangumiAuth] OAuth authorization page opened')
  return { success: true }
}

/**
 * Complete the OAuth login, called from the app entry point when the browser redirects to
 * `vnite://bgm/callback`. Authorization codes are valid for 60 seconds only, so this has to run
 * the moment the deep link arrives.
 */
export async function handleBangumiOAuthCallback(url: string): Promise<void> {
  try {
    const parsed = new URL(url)
    const code = parsed.searchParams.get('code')
    const state = parsed.searchParams.get('state')

    if (!code) {
      log.error('[BangumiAuth] Authorization callback carried no code')
      return
    }

    if (!pendingOAuthState || state !== pendingOAuthState) {
      log.error('[BangumiAuth] Authorization callback state mismatch; ignoring it')
      return
    }
    pendingOAuthState = null

    const client = getOAuthClient()
    if (!client) {
      log.error('[BangumiAuth] Callback arrived but this build has no client credentials')
      return
    }

    const credentials = await requestToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        redirect_uri: BANGUMI_REDIRECT_URI
      }),
      ''
    )

    if (!credentials) {
      log.error('[BangumiAuth] Could not exchange the authorization code for a token')
      return
    }

    await writeCredentials(credentials)
    log.info(`[BangumiAuth] Signed in as ${credentials.userName || 'unknown user'}`)
  } catch (error) {
    log.error('[BangumiAuth] Failed to handle the authorization callback:', error)
  }
}
