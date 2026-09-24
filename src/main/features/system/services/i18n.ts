import i18next from 'i18next'
import Backend from 'i18next-fs-backend'
import resourcesToBackend from 'i18next-resources-to-backend'
import { app } from 'electron'
import { ConfigDBManager } from '~/core/database'
import { eventBus } from '~/core/events'
import log from 'electron-log/main'

export async function getLanguage(): Promise<string> {
  try {
    const language = await ConfigDBManager.getConfigValue('general.language')
    if (language) {
      return language
    } else {
      await ConfigDBManager.setConfigValue('general.language', app.getLocale())
      return app.getLocale()
    }
  } catch (error) {
    log.error('[I18n] Failed to get language:', error)
    throw error
  }
}

/**
 * 界面语言 → **词库 / 译名语言代码**（`zh-CN` → `zh-Hans`、`zh-TW` → `zh-Hant`，其余同名）。
 *
 * 取自 locale 文件的 `scraper:vndb.languageCode`，与游戏标题译名的语言选择保持同一口径，
 * 不另造一套「界面语言」概念；没配置该语言代码的界面（fr / it / ru 是空串）回退 i18next 当前语言。
 *
 * `lng` 是可选覆盖：抓取源有时会**替用户换一个语言**（DLsite 不支持 ru，会给日文页面），
 * 那时要用映射后那个语言的词库代码，否则日文文本会被登记成 `names.ru`。
 *
 * ⚠️ 与 `getLanguage()` 是**两套代码**，别混用：`getLanguage()` 给的是 UI/HTTP 代码
 * （`zh-CN`，DLsite 的 `?locale=` 要的正是它），而词库按 `zh-Hans` 分表。
 */
export function getTagLanguage(lng?: string): string {
  if (lng) {
    // ⚠️ 语言包是**按需加载**的：未加载时 `t(key, { lng })` 返回的是**兜底语言（en）的翻译**，
    // 那是个「看起来合理但错误」的结果 —— 实测 ru 界面的 DLsite 抓取（站点其实返回日文）把
    // 日文标签登记成了 `names.en`。所以先看资源在不在；不在就退回 `lng` 本身，
    // 而不是把 en 的代码当成答案。调用方最好先 `await i18next.loadLanguages(lng)`。
    const resource = i18next.getResource(lng, 'scraper', 'vndb.languageCode')
    if (typeof resource !== 'string' || !resource) return lng
    return resource
  }

  const code = i18next.t('scraper:vndb.languageCode')
  return typeof code === 'string' && code ? code : i18next.language || 'en'
}

export async function initI18n(): Promise<void> {
  try {
    const language = await getLanguage()

    const namespaces = ['tray', 'scraper', 'context-menu', 'system-notification']

    const supportedLngs = ['zh-CN', 'zh-TW', 'ja', 'en', 'ru', 'fr', 'ko']

    await i18next
      .use(Backend)
      .use(
        resourcesToBackend(async (language: string, namespace: string) => {
          return import(`@locales/${language}/${namespace}.json`).catch((error) => {
            console.error(`Unable to load translation file: ${language}/${namespace}`, error)
            return {}
          })
        })
      )
      .init({
        lng: language,
        fallbackLng: 'en',
        ns: namespaces,
        defaultNS: 'tray',
        returnEmptyString: false,
        partialBundledLanguages: true,
        supportedLngs
      })
  } catch (error) {
    log.error('[I18n] Initialization error:', error)
    throw error
  }
}

export async function updateLanguage(language: string): Promise<void> {
  try {
    await i18next.changeLanguage(language)
    eventBus.emit('language:changed', { newLanguage: language }, { source: 'i18n-service' })
  } catch (error) {
    log.error('[I18n] Failed to update language:', error)
    throw error
  }
}
