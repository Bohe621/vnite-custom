import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BangumiTokenStatus } from '@appTypes/utils'
import { ipcManager } from '~/app/ipc'
import { ConfigItemPure } from '~/components/form/ConfigItemPure'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { cn } from '~/utils'

/**
 * Bangumi hides NSFW-restricted subjects from anonymous callers: the search endpoint still lists
 * them, but fetching a subject's details answers 404. Anything scanned from Bangumi therefore
 * fails with an opaque error until a token is configured, so both ways of obtaining one — a
 * personal access token, or the official OAuth flow — live here.
 *
 * Laid out with `ConfigItemPure` so each row matches the other settings sections on this page.
 */
export function BangumiTokenSettings(): React.JSX.Element {
  const { t } = useTranslation('config')
  const [status, setStatus] = useState<BangumiTokenStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshStatus = useCallback(async (): Promise<void> => {
    setStatus(await ipcManager.invoke('scraper:bangumi-token-status'))
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  /** The main process reports machine-readable codes; only this component knows the wording. */
  const messageForError = (code?: string): string => {
    switch (code) {
      case 'empty':
        return t('scraper.bangumi.notifications.empty')
      case 'oauth-unavailable':
        return t('scraper.bangumi.notifications.oauthUnavailable')
      default:
        return t('scraper.bangumi.notifications.invalid')
    }
  }

  const handleSave = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await ipcManager.invoke('scraper:bangumi-set-token', token)
      if (result.success) {
        toast.success(t('scraper.bangumi.notifications.saved', { name: result.userName || '' }))
        setToken('')
        await refreshStatus()
      } else {
        toast.error(messageForError(result.error))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleGetToken = async (): Promise<void> => {
    await ipcManager.invoke('scraper:bangumi-open-token-page')
  }

  const handleOAuth = async (): Promise<void> => {
    const result = await ipcManager.invoke('scraper:bangumi-oauth-start')
    if (result.success) {
      toast.info(t('scraper.bangumi.notifications.oauthStarted'))
    } else {
      toast.error(messageForError(result.error))
    }
  }

  const handleClear = async (): Promise<void> => {
    await ipcManager.invoke('scraper:bangumi-clear-token')
    await refreshStatus()
    toast.success(t('scraper.bangumi.notifications.cleared'))
  }

  const statusLabel = !status
    ? ''
    : status.configured
      ? status.userName
        ? t('scraper.bangumi.status.connected', { name: status.userName })
        : t('scraper.bangumi.status.connectedUnknown')
      : t('scraper.bangumi.status.notConfigured')

  const sourceHint =
    status?.oauthAvailable === true
      ? `${t('scraper.bangumi.getTokenDescription')} ${t('scraper.bangumi.oauthDescription')}`
      : t('scraper.bangumi.getTokenDescription')

  return (
    <div id="config-section-bangumi" className={cn('space-y-4')}>
      <div className={cn('border-b pb-2')}>{t('scraper.bangumi.title')}</div>

      <div className={cn('space-y-4')}>
        <ConfigItemPure
          title={t('scraper.bangumi.token')}
          description={statusLabel}
          controlClassName="w-[360px]"
        >
          <div className={cn('flex w-full gap-2')}>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('scraper.bangumi.tokenPlaceholder')}
              className={cn('flex-grow')}
              disabled={busy}
            />
            <Button onClick={handleSave} disabled={busy || !token.trim()}>
              {t('scraper.bangumi.actions.save')}
            </Button>
          </div>
        </ConfigItemPure>

        <ConfigItemPure title={t('scraper.bangumi.tokenSource')} description={sourceHint}>
          <div className={cn('flex gap-2')}>
            <Button variant="outline" onClick={handleGetToken}>
              {t('scraper.bangumi.getToken')}
            </Button>
            {status?.oauthAvailable === true ? (
              <Button variant="outline" onClick={handleOAuth}>
                {t('scraper.bangumi.oauthLogin')}
              </Button>
            ) : null}
            {status?.configured === true ? (
              <Button variant="ghost" onClick={handleClear}>
                {t('scraper.bangumi.actions.clear')}
              </Button>
            ) : null}
          </div>
        </ConfigItemPure>
      </div>
    </div>
  )
}
