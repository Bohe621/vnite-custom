import { scraperManager } from './services'
import {
  clearBangumiToken,
  getBangumiTokenStatus,
  openBangumiTokenPage,
  setBangumiManualToken,
  startBangumiOAuth
} from './services/bangumiAuth'
import { ScraperIdentifier } from '@appTypes/utils'
import { ipcManager } from '~/core/ipc'
import { ScraperCapabilities } from './services/types'

export function setupScraperIPC(): void {
  // Bangumi credentials. Bangumi hides NSFW-restricted subjects from anonymous callers, so
  // anything the user scrapes from it may need a token before it can be read.
  ipcManager.handle('scraper:bangumi-token-status', async () => {
    return await getBangumiTokenStatus()
  })

  ipcManager.handle('scraper:bangumi-set-token', async (_, token: string) => {
    return await setBangumiManualToken(token)
  })

  ipcManager.handle('scraper:bangumi-clear-token', async () => {
    await clearBangumiToken()
  })

  ipcManager.handle('scraper:bangumi-open-token-page', async () => {
    await openBangumiTokenPage()
  })

  ipcManager.handle('scraper:bangumi-oauth-start', async () => {
    return await startBangumiOAuth()
  })

  ipcManager.handle('scraper:search-games', async (_, dataSource: string, gameName: string) => {
    return await scraperManager.searchGames(dataSource, gameName)
  })

  ipcManager.handle(
    'scraper:check-game-exists',
    async (_, dataSource: string, identifier: ScraperIdentifier) => {
      return await scraperManager.checkGameExists(dataSource, identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-metadata',
    async (_, dataSource: string, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameMetadata(dataSource, identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-backgrounds',
    async (_, dataSource: string, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameBackgrounds(dataSource, identifier)
    }
  )

  // 汇总所有源的背景图（带来源标记），供添加游戏时挑选。
  ipcManager.handle(
    'scraper:get-all-game-backgrounds',
    async (_, dataSource: string, identifier: ScraperIdentifier, gameName: string) => {
      return await scraperManager.getAllGameBackgrounds(dataSource, identifier, gameName)
    }
  )

  ipcManager.handle(
    'scraper:get-game-wide-covers',
    async (_, dataSource: string, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameWideCovers(dataSource, identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-covers',
    async (_, dataSource: string, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameCovers(dataSource, identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-icons',
    async (_, dataSource: string, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameIcons(dataSource, identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-logos',
    async (_, dataSource: string, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameLogos(dataSource, identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-description-list',
    async (_, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameDescriptionList(identifier)
    }
  )

  ipcManager.handle('scraper:get-game-tags-list', async (_, identifier: ScraperIdentifier) => {
    return await scraperManager.getGameTagsList(identifier)
  })

  ipcManager.handle(
    'scraper:get-game-extra-info-list',
    async (_, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameExtraInfoList(identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-developers-list',
    async (_, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameDevelopersList(identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-publishers-list',
    async (_, identifier: ScraperIdentifier) => {
      return await scraperManager.getGamePublishersList(identifier)
    }
  )

  ipcManager.handle('scraper:get-game-genres-list', async (_, identifier: ScraperIdentifier) => {
    return await scraperManager.getGameGenresList(identifier)
  })

  ipcManager.handle('scraper:get-game-platforms-list', async (_, identifier: ScraperIdentifier) => {
    return await scraperManager.getGamePlatformsList(identifier)
  })

  ipcManager.handle(
    'scraper:get-game-related-sites-list',
    async (_, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameRelatedSitesList(identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-game-information-list',
    async (_, identifier: ScraperIdentifier) => {
      return await scraperManager.getGameInformationList(identifier)
    }
  )

  ipcManager.handle(
    'scraper:get-provider-infos-with-capabilities',
    async (_, capabilities: ScraperCapabilities[], requireAll = true) => {
      return scraperManager.getProviderInfosWithCapabilities(capabilities, requireAll)
    }
  )
}
