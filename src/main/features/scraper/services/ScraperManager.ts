import { ScraperProvider, ScraperCapabilities } from './types'
import {
  GameList,
  GameMetadata,
  ScraperIdentifier,
  GameDescriptionList,
  GameTagsList,
  GameExtraInfoList,
  GameDevelopersList,
  GamePublishersList,
  GameGenresList,
  GamePlatformsList,
  GameRelatedSitesList,
  GameInformationList
} from '@appTypes/utils'
import { withTimeout } from '~/utils'
import { Transformer } from '~/features/transformer'
import { TagLexiconManager } from '~/features/tagLexicon/services'
import log from 'electron-log/main'

export class ScraperManager {
  private providers: Map<string, ScraperProvider> = new Map()

  public registerProvider(provider: ScraperProvider): void {
    this.providers.set(provider.id, provider)
  }

  public unregisterProvider(providerId: string): void {
    this.providers.delete(providerId)
  }

  public getProvider(providerId: string): ScraperProvider | undefined {
    return this.providers.get(providerId)
  }

  public getAllProviders(): ScraperProvider[] {
    return Array.from(this.providers.values())
  }

  public getProviderIds(): string[] {
    return Array.from(this.providers.keys())
  }

  public hasProvider(providerId: string): boolean {
    return this.providers.has(providerId)
  }

  public async searchGames(
    providerId: string,
    gameName: string,
    gamePath?: string
  ): Promise<GameList> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.searchGames) {
        throw new Error(`Provider '${providerId}' does not support searching games`)
      }
      return provider.searchGames(gameName, gamePath)
    } catch (error) {
      log.error(`[Scraper] Failed to search games using provider '${providerId}': ${error}`)
      throw error
    }
  }

  public async checkGameExists(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<boolean> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.checkGameExists) {
        throw new Error(`Provider '${providerId}' does not support checking game existence`)
      }
      return provider.checkGameExists(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to check game existence using provider '${providerId}': ${error}`)
      return false
    }
  }

  public async getGameMetadata(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<GameMetadata> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameMetadata) {
        throw new Error(`Provider '${providerId}' does not support getting game metadata`)
      }
      const metadata = await provider.getGameMetadata(identifier)
      const normalized = await this.normalizeMetadataTags(metadata, providerId)
      return Transformer.transformMetadata(normalized, '#all')
    } catch (error) {
      log.error(`[Scraper] Failed to get game metadata using provider '${providerId}': ${error}`)
      throw error
    }
  }

  /**
   * 把 provider 返回的标签统一过一遍词库：解析成实体 key，没见过的现场铸造。
   *
   * 集中在这层做，让「同一标签跨源归并」只由一处负责：各源的写法先试命中同一实体，命中不了
   * 才各自成新实体。归并的钥匙两档（按可靠性）：① `tagsDetail.ids` 的**源内稳定 id**（DLsite
   * `genre:288`）——唯一能跨语言归并的办法（文本随 `?locale=` 变，纯文本串不起来）；② 文本本身
   * （全语言名字索引，适用于文本稳定的源）。登记语言优先取 `tagsDetail.language`，否则按 provider
   * 名推断。
   *
   * ⚠️ `tagsDetail` 是中间数据，返回前必须剥掉，否则会写进游戏文档；词库兜住异常、退回原始标签。
   */
  private async normalizeMetadataTags(
    metadata: GameMetadata,
    providerId: string
  ): Promise<GameMetadata> {
    const tags = metadata.tags
    // 无论后面走哪条分支，明细都不能留在返回值里 —— 它不是游戏元数据的一部分
    const { tagsDetail, ...clean } = metadata
    const idByRaw = new Map<string, string>()
    for (const item of tagsDetail?.ids ?? []) {
      if (item?.raw && item.id) idByRaw.set(item.raw, item.id)
    }

    if (!tags || tags.length === 0) return clean

    try {
      const keys = await TagLexiconManager.getInstance().ensureTags(
        tags,
        providerId,
        tagsDetail?.language,
        idByRaw.size > 0 ? idByRaw : undefined
      )
      return { ...clean, tags: keys }
    } catch (error) {
      log.error(`[Scraper] Failed to normalize tags from '${providerId}': ${error}`)
      return clean
    }
  }

  public async getGameBackgrounds(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameBackgrounds) {
        throw new Error(`Provider '${providerId}' does not support getting game backgrounds`)
      }
      return provider.getGameBackgrounds(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game backgrounds using provider '${providerId}': ${error}`)
      // Return an empty array on error, preventing interruptions
      return []
    }
  }

  public async getGameWideCovers(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameWideCovers) {
        throw new Error(`Provider '${providerId}' does not support getting game wide covers`)
      }
      return provider.getGameWideCovers(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game wide covers using provider '${providerId}': ${error}`)
      return []
    }
  }

  public async getGameCovers(providerId: string, identifier: ScraperIdentifier): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameCovers) {
        throw new Error(`Provider '${providerId}' does not support getting game covers`)
      }
      return provider.getGameCovers(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game covers using provider '${providerId}': ${error}`)
      // Return an empty array on error, preventing interruptions
      return []
    }
  }

  public async getGameLogos(providerId: string, identifier: ScraperIdentifier): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameLogos) {
        throw new Error(`Provider '${providerId}' does not support getting game logos`)
      }
      return provider.getGameLogos(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game logos using provider '${providerId}': ${error}`)
      // Return an empty array on error, preventing interruptions
      return []
    }
  }

  public async getGameIcons(providerId: string, identifier: ScraperIdentifier): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameIcons) {
        throw new Error(`Provider '${providerId}' does not support getting game icons`)
      }
      return provider.getGameIcons(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game icons using provider '${providerId}': ${error}`)
      // Return an empty array on error, preventing interruptions
      return []
    }
  }

  public clearProviders(): void {
    this.providers.clear()
  }

  private getProviderCapabilities(provider: ScraperProvider): ScraperCapabilities[] {
    return Object.keys(provider)
      .filter((key) => key !== 'id' && key !== 'name')
      .filter((key) => typeof provider[key] === 'function')
      .map((key) => key as ScraperCapabilities)
  }

  public getProviderInfo(providerId: string): {
    id: string
    name: string
    capabilities: ScraperCapabilities[]
  } {
    const provider = this.getProvider(providerId)
    if (!provider) {
      throw new Error(`Provider '${providerId}' not found`)
    }
    return {
      id: provider.id,
      name: provider.name,
      capabilities: this.getProviderCapabilities(provider)
    }
  }

  public getProviderInfosWithCapabilities(
    capabilities: ScraperCapabilities[],
    requireAll: boolean = true
  ): { id: string; name: string; capabilities: ScraperCapabilities[] }[] {
    return this.getAllProviders()
      .filter((provider) => {
        const providerCapabilities = this.getProviderCapabilities(provider)

        if (requireAll) {
          return capabilities.every((capability) => providerCapabilities.includes(capability))
        } else {
          return capabilities.some((capability) => providerCapabilities.includes(capability))
        }
      })
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        capabilities: capabilities.filter((capability) =>
          this.getProviderCapabilities(provider).includes(capability)
        )
      }))
  }

  private getProviderIdsWithCapabilities(
    capabilities: ScraperCapabilities[],
    requireAll: boolean = true
  ): string[] {
    return this.getProviderInfosWithCapabilities(capabilities, requireAll).map(
      (providerInfo) => providerInfo.id
    )
  }

  public async getGameDescriptionList(identifier: ScraperIdentifier): Promise<GameDescriptionList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, description: metadata.description || '' }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, description: '' }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; description: string }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.description)

      const descriptionList = candidates as GameDescriptionList
      return await Transformer.transformDescriptionList(descriptionList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game description list: ${error}`)
      throw error
    }
  }

  public async getGameTagsList(identifier: ScraperIdentifier): Promise<GameTagsList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, tags: metadata.tags || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, tags: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; tags: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.tags.length > 0)

      const tagsList = candidates as GameTagsList
      return await Transformer.transformTagsList(tagsList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game tags list: ${error}`)
      throw error
    }
  }

  public async getGameExtraInfoList(identifier: ScraperIdentifier): Promise<GameExtraInfoList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, extra: metadata.extra || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, extra: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; extra: any[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.extra && item.extra.length > 0)

      const extraInfoList = candidates as GameExtraInfoList
      return await Transformer.transformExtraInfoList(extraInfoList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game extra info list: ${error}`)
      throw error
    }
  }

  public async getGameDevelopersList(identifier: ScraperIdentifier): Promise<GameDevelopersList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, developers: metadata.developers || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, developers: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{ dataSource: string; developers: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.developers && item.developers.length > 0)

      const developersList = candidates as GameDevelopersList
      return await Transformer.transformDevelopersList(developersList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game developers list: ${error}`)
      throw error
    }
  }

  public async getGamePublishersList(identifier: ScraperIdentifier): Promise<GamePublishersList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, publishers: metadata.publishers || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, publishers: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{ dataSource: string; publishers: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.publishers && item.publishers.length > 0)

      const publishersList = candidates as GamePublishersList
      return await Transformer.transformPublishersList(publishersList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game publishers list: ${error}`)
      throw error
    }
  }

  public async getGameGenresList(identifier: ScraperIdentifier): Promise<GameGenresList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, genres: metadata.genres || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, genres: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; genres: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.genres && item.genres.length > 0)

      const genresList = candidates as GameGenresList
      return await Transformer.transformGenresList(genresList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game genres list: ${error}`)
      throw error
    }
  }

  public async getGamePlatformsList(identifier: ScraperIdentifier): Promise<GamePlatformsList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, platforms: metadata.platforms || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, platforms: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; platforms: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.platforms && item.platforms.length > 0)

      const platformsList = candidates as GamePlatformsList
      return await Transformer.transformPlatformsList(platformsList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game platforms list: ${error}`)
      throw error
    }
  }

  public async getGameRelatedSitesList(
    identifier: ScraperIdentifier
  ): Promise<GameRelatedSitesList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, relatedSites: metadata.relatedSites || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, relatedSites: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; relatedSites: any[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.relatedSites && item.relatedSites.length > 0)

      const relatedSitesList = candidates as GameRelatedSitesList
      return await Transformer.transformRelatedSitesList(relatedSitesList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game related sites list: ${error}`)
      throw error
    }
  }

  public async getGameInformationList(identifier: ScraperIdentifier): Promise<GameInformationList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return {
              dataSource: providerId,
              information: {
                name: metadata.name || undefined,
                originalName: metadata.originalName || undefined,
                releaseDate: metadata.releaseDate || undefined,
                developers:
                  metadata.developers && metadata.developers.length > 0
                    ? metadata.developers
                    : undefined,
                publishers:
                  metadata.publishers && metadata.publishers.length > 0
                    ? metadata.publishers
                    : undefined,
                genres: metadata.genres && metadata.genres.length > 0 ? metadata.genres : undefined,
                platforms:
                  metadata.platforms && metadata.platforms.length > 0
                    ? metadata.platforms
                    : undefined
              }
            }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return {
              dataSource: providerId,
              information: {}
            }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{
            dataSource: string
            information: any
          }> => result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => {
          const info = item.information
          return (
            info &&
            (info.name ||
              info.originalName ||
              info.releaseDate ||
              (info.developers && info.developers.length > 0) ||
              (info.publishers && info.publishers.length > 0) ||
              (info.genres && info.genres.length > 0) ||
              (info.platforms && info.platforms.length > 0))
          )
        })

      const informationList = candidates as GameInformationList
      return await Transformer.transformInformationList(informationList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game information list: ${error}`)
      throw error
    }
  }
}

// Export singleton instance
export const scraperManager = new ScraperManager()
