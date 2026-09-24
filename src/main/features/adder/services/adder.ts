import { BatchGameInfo, DEFAULT_GAME_LOCAL_VALUES, DEFAULT_GAME_VALUES } from '@appTypes/models'
import {
  GameDescriptionList,
  GameDevelopersList,
  GameExtraInfoList,
  GameGenresList,
  GameMetadata,
  GamePlatformsList,
  GamePublishersList,
  GameRelatedSitesList,
  GameTagsList,
  type GameImageUpscaleOptions
} from '@appTypes/utils'
import { generateUUID, normalizeGameLocalDoc } from '@appUtils'
import log from 'electron-log/main'
import path from 'path'
import { ConfigDBManager, GameDBManager } from '~/core/database'
import { eventBus } from '~/core/events'
import {
  calculateStorageSizeForPath,
  isAutoCalculateStorageSizeEnabled,
  saveGameIconByFile,
  tryUpscaleGameImage
} from '~/features/game'
import { launcherPreset } from '~/features/launcher'
import { scraperManager } from '~/features/scraper'
import { cacheDescriptionImages } from '~/features/scraper/services/descriptionImageCache'
import { getGameFolders, selectPathDialog, inferRootPath } from '~/utils'
import { DlsiteFolderNameMetadata, parseDlsiteFolderName } from './dlsiteFolderName'
import { isUserAuthoredKey, mergeTagKeys } from './tagMerge'

export async function addGameToDB({
  dataSource,
  dataSourceId,
  backgroundUrl,
  upscaleEnabled,
  upscaleOptionsOverride,
  playTime,
  dirPath,
  gamePath,
  targetCollection,
  scanRoot,
  prefetchedMetadata
}: {
  dataSource: string
  dataSourceId: string
  backgroundUrl?: string
  upscaleEnabled?: boolean
  upscaleOptionsOverride?: GameImageUpscaleOptions
  playTime?: number
  dirPath?: string
  gamePath?: string
  targetCollection?: string
  scanRoot?: string
  /**
   * Metadata the caller already fetched (the scanner does, to compare identities with games that
   * are already in the library). Passing it saves a second round trip to the provider.
   */
  prefetchedMetadata?: GameMetadata
}): Promise<string> {
  try {
    const dbId = generateUUID()

    // Get the provider information to determine capabilities
    const providerInfo = scraperManager.getProviderInfo(dataSource)
    const providerCapabilities = providerInfo?.capabilities || []

    // Get the base metadata first
    const baseMetadata =
      prefetchedMetadata ??
      (await scraperManager.getGameMetadata(dataSource, {
        type: 'id',
        value: dataSourceId
      }))

    // Create a copy of the base metadata to avoid modifying the original
    const metadata = JSON.parse(JSON.stringify(baseMetadata)) as GameMetadata

    // Prepare tasks to fetch missing data
    const enhancementTasks: Promise<any>[] = []

    // Check and fetch missing description information
    if (!metadata.description || metadata.description.trim() === '') {
      enhancementTasks.push(
        scraperManager
          .getGameDescriptionList?.({
            type: 'name',
            value: metadata.originalName || metadata.name
          })
          .catch((err) => {
            console.warn(`Failed to get game description: ${err.message}`)
            return []
          })
      )
    } else {
      enhancementTasks.push(Promise.resolve(null))
    }

    // Check and fetch missing tags information
    if (!metadata.tags || metadata.tags.length === 0) {
      enhancementTasks.push(
        scraperManager
          .getGameTagsList?.({
            type: 'name',
            value: metadata.originalName || metadata.name
          })
          .catch((err) => {
            console.warn(`Failed to get game tags: ${err.message}`)
            return []
          })
      )
    } else {
      enhancementTasks.push(Promise.resolve(null))
    }

    // Check and fetch missing extra information
    if (!metadata.extra || Object.keys(metadata.extra).length === 0) {
      enhancementTasks.push(
        scraperManager
          .getGameExtraInfoList?.({
            type: 'name',
            value: metadata.originalName || metadata.name
          })
          .catch((err) => {
            console.warn(`Failed to get game extra information: ${err.message}`)
            return {}
          })
      )
    } else {
      enhancementTasks.push(Promise.resolve(null))
    }

    // Check and fetch missing developers information
    if (!metadata.developers || metadata.developers.length === 0) {
      enhancementTasks.push(
        scraperManager
          .getGameDevelopersList?.({
            type: 'name',
            value: metadata.originalName || metadata.name
          })
          .catch((err) => {
            console.warn(`Failed to get game developers: ${err.message}`)
            return []
          })
      )
    } else {
      enhancementTasks.push(Promise.resolve(null))
    }

    // Check and fetch missing publishers information
    if (!metadata.publishers || metadata.publishers.length === 0) {
      enhancementTasks.push(
        scraperManager
          .getGamePublishersList?.({
            type: 'name',
            value: metadata.originalName || metadata.name
          })
          .catch((err) => {
            console.warn(`Failed to get game publishers: ${err.message}`)
            return []
          })
      )
    } else {
      enhancementTasks.push(Promise.resolve(null))
    }

    // Check and fetch missing genres information
    if (!metadata.genres || metadata.genres.length === 0) {
      enhancementTasks.push(
        scraperManager
          .getGameGenresList?.({
            type: 'name',
            value: metadata.originalName || metadata.name
          })
          .catch((err) => {
            console.warn(`Failed to get game genres: ${err.message}`)
            return []
          })
      )
    } else {
      enhancementTasks.push(Promise.resolve(null))
    }

    // Check and fetch missing platforms information
    if (!metadata.platforms || metadata.platforms.length === 0) {
      enhancementTasks.push(
        scraperManager
          .getGamePlatformsList?.({
            type: 'name',
            value: metadata.originalName || metadata.name
          })
          .catch((err) => {
            console.warn(`Failed to get game platforms: ${err.message}`)
            return []
          })
      )
    } else {
      enhancementTasks.push(Promise.resolve(null))
    }

    // Check and fetch missing related sites information
    if (!metadata.relatedSites || metadata.relatedSites.length === 0) {
      enhancementTasks.push(
        scraperManager
          .getGameRelatedSitesList?.({
            type: 'name',
            value: metadata.originalName || metadata.name
          })
          .catch((err) => {
            console.warn(`Failed to get game related sites: ${err.message}`)
            return []
          })
      )
    } else {
      enhancementTasks.push(Promise.resolve(null))
    }

    // Execute all enhancement tasks
    const [descriptions, tags, extra, developers, publishers, genres, platforms, relatedSites] =
      (await Promise.all(enhancementTasks)) as [
        GameDescriptionList,
        GameTagsList,
        GameExtraInfoList,
        GameDevelopersList,
        GamePublishersList,
        GameGenresList,
        GamePlatformsList,
        GameRelatedSitesList
      ]

    // Merge fetched data into metadata
    if (descriptions && descriptions.length > 0) {
      metadata.description = descriptions[0].description
    }

    if (tags && tags.length > 0) {
      // 合并**所有**源的标签并去重，而不是只取 `tags[0]`（「第一个」由 provider 注册顺序决定，
      // 不是用户意图）。落库的是实体 key（`getGameTagsList` 已归一）；`existing` 传 `undefined`
      // 因为首次入库库里还没有标签。
      metadata.tags = mergeTagKeys(
        undefined,
        tags.flatMap((item) => item.tags),
        'merge',
        isUserAuthoredKey
      )
    }

    if (extra && Object.keys(extra).length > 0) {
      metadata.extra = extra[0].extra
    }

    if (developers && developers.length > 0) {
      metadata.developers = developers[0].developers
    }

    if (publishers && publishers.length > 0) {
      metadata.publishers = publishers[0].publishers
    }

    if (genres && genres.length > 0) {
      metadata.genres = genres[0].genres
    }

    if (platforms && platforms.length > 0) {
      metadata.platforms = platforms[0].platforms
    }

    if (relatedSites && relatedSites.length > 0) {
      metadata.relatedSites = relatedSites[0].relatedSites
    }

    // Prepare game document, deep copy to avoid mutation
    const gameDoc = JSON.parse(JSON.stringify(DEFAULT_GAME_VALUES))
    gameDoc._id = dbId
    gameDoc.metadata = {
      ...gameDoc.metadata,
      ...metadata,
      originalName: metadata.originalName ?? '',
      [`${dataSource}Id`]: dataSourceId
    }

    // The DLsite folder name carries the Chinese title and the version of the copy on disk.
    // Neither can come from the scraper: DLsite returns the Japanese title for both `name` and
    // `originalName`, and it has no concept of a version number at all.
    const folderNameMetadata = await resolveFolderNameMetadata(dirPath)
    if (folderNameMetadata.localizedName) {
      gameDoc.metadata.name = folderNameMetadata.localizedName
    }
    if (folderNameMetadata.version) {
      gameDoc.metadata.version = folderNameMetadata.version
    }

    if (playTime) {
      gameDoc.record.playTime = playTime
    }
    gameDoc.record.addDate = new Date().toISOString()

    const gameLocalDoc = JSON.parse(JSON.stringify(DEFAULT_GAME_LOCAL_VALUES))
    gameLocalDoc._id = dbId
    gameLocalDoc.utils.markPath = dirPath ?? ''
    gameLocalDoc.utils.rootPath = inferRootPath(gameLocalDoc.utils.markPath, scanRoot)
    gameLocalDoc.path.gamePath = gamePath ?? ''
    // Seed the first version so a brand new game is multi-version ready from the start.
    normalizeGameLocalDoc(gameLocalDoc, {
      defaultVersionName: (gameDoc.metadata.version ?? '').trim()
    })

    // Calculate storage size if enabled
    const autoCalculateSize = await isAutoCalculateStorageSizeEnabled()
    if (autoCalculateSize && gameLocalDoc.utils.rootPath) {
      gameDoc.record.storageSize = await calculateStorageSizeForPath(gameLocalDoc.utils.rootPath)
    }

    // Prepare image fetching tasks
    const imagePromises: {
      covers: Promise<string[]>
      backgrounds: Promise<string[]>
      icons?: Promise<string[]>
      logos?: Promise<string[]>
    } = {
      covers: scraperManager
        .getGameCovers(dataSource, { type: 'id', value: dataSourceId })
        .catch((err) => {
          console.warn(`Failed to get game covers: ${err.message}`)
          return []
        }),
      // Use backgroundUrl if provided, otherwise fetch from scraper
      backgrounds: !backgroundUrl
        ? scraperManager
            .getGameBackgrounds(dataSource, { type: 'id', value: dataSourceId })
            .catch((err) => {
              console.warn(`Failed to get game backgrounds: ${err.message}`)
              return []
            })
        : Promise.resolve([])
    }

    // Check if the data source supports fetching icons and logos
    const hasIconCapability = providerCapabilities.includes('getGameIcons')
    const hasLogoCapability = providerCapabilities.includes('getGameLogos')

    // Choose the method to fetch icons based on data source capabilities
    if (hasIconCapability) {
      // If the current data source supports fetching icons
      imagePromises.icons = scraperManager
        .getGameIcons(dataSource, {
          type: 'id',
          value: dataSourceId
        })
        .catch((err) => {
          console.warn(`Failed to get game icons: ${err.message}`)
          return []
        })
    } else {
      // Use fallback data source steamgriddb to fetch icons
      imagePromises.icons = scraperManager
        .getGameIcons(
          'steamgriddb',
          dataSource === 'steam'
            ? { type: 'id', value: dataSourceId }
            : { type: 'name', value: metadata.originalName || metadata.name }
        )
        .catch((err) => {
          console.warn(`Failed to get game icons: ${err.message}`)
          return []
        })
    }

    // Choose the method to fetch logos based on data source capabilities
    if (hasLogoCapability) {
      // If the current data source supports fetching logos
      imagePromises.logos = scraperManager
        .getGameLogos(dataSource, {
          type: 'id',
          value: dataSourceId
        })
        .catch((err) => {
          console.warn(`Failed to get game logos: ${err.message}`)
          return []
        })
    } else {
      // Use fallback data source steamgriddb to fetch logos
      imagePromises.logos = scraperManager
        .getGameLogos(
          'steamgriddb',
          dataSource === 'steam'
            ? { type: 'id', value: dataSourceId }
            : { type: 'name', value: metadata.originalName || metadata.name }
        )
        .catch((err) => {
          console.warn(`Failed to get game logos: ${err.message}`)
          return []
        })
    }

    // Fetch all image resources in parallel
    const imageResults = await Promise.all([
      imagePromises.covers,
      imagePromises.backgrounds,
      imagePromises.icons,
      imagePromises.logos
    ])

    const [covers, backgrounds, icons, logos] = imageResults

    // Prepare all database write operations
    const dbPromises: Promise<unknown>[] = [
      GameDBManager.setGame(dbId, gameDoc),
      GameDBManager.setGameLocal(dbId, gameLocalDoc),
      targetCollection
        ? GameDBManager.addGameToCollection(dbId, targetCollection)
        : Promise.resolve()
    ]

    // Prepare all image saving operations
    if (covers.length > 0 && covers[0]) {
      dbPromises.push(
        GameDBManager.setGameImage(dbId, 'cover', covers[0]).catch((err) => {
          log.warn(`[Adder] Failed to save game cover: ${err.message}`)
        })
      )
    }

    if (backgroundUrl) {
      const backgroundImage = await tryUpscaleGameImage(
        backgroundUrl,
        upscaleEnabled,
        upscaleOptionsOverride
      )
      dbPromises.push(
        GameDBManager.setGameImage(dbId, 'background', backgroundImage).catch((err) => {
          log.warn(`[Adder] Failed to save game background from URL: ${err.message}`)
        })
      )
    } else if (backgrounds.length > 0 && backgrounds[0]) {
      const backgroundImage = await tryUpscaleGameImage(
        backgrounds[0],
        upscaleEnabled,
        upscaleOptionsOverride
      )
      dbPromises.push(
        GameDBManager.setGameImage(dbId, 'background', backgroundImage).catch((err) => {
          log.warn(`[Adder] Failed to save game background: ${err.message}`)
        })
      )
    }

    if (icons.length > 0 && icons[0]) {
      dbPromises.push(
        GameDBManager.setGameImage(dbId, 'icon', icons[0].toString()).catch((err) => {
          log.warn(`[Adder] Failed to save game icon: ${err.message}`)
        })
      )
    } else if (gamePath) {
      // If no icon fetched, try to save icon from the game executable
      dbPromises.push(
        saveGameIconByFile(dbId, gamePath).catch((err) => {
          log.warn(`[Adder] Failed to save game icon from executable: ${err.message}`)
        })
      )
    }

    if (logos.length > 0 && logos[0]) {
      dbPromises.push(
        GameDBManager.setGameImage(dbId, 'logo', logos[0].toString()).catch((err) => {
          log.warn(`[Adder] Failed to save game logo: ${err.message}`)
        })
      )
    }

    // Execute all database operations (in parallel)
    await Promise.all(dbPromises)

    await cacheDescriptionImages(metadata.description, dbId)

    // Set the launcher preset
    if (gamePath) await launcherPreset('default', dbId)

    // Emit event to notify other parts of the application
    eventBus.emit(
      'game:added',
      {
        gameId: dbId,
        name: gameDoc.metadata.name,
        dataSource,
        metadata
      },
      { source: 'adder' }
    )

    return dbId
  } catch (error) {
    log.error('[Adder] Failed to add game to database:', error)
    throw error
  }
}

/**
 * Read the Chinese title and the version number out of a DLsite-style folder name.
 *
 * Returns nothing unless "detect DLsite ID in folder name" is enabled: that switch already means
 * "the folder name follows the DLsite convention", which is exactly the precondition for parsing
 * the rest of it. Folders without a DLsite id are left alone as well.
 */
async function resolveFolderNameMetadata(dirPath?: string): Promise<DlsiteFolderNameMetadata> {
  if (!dirPath) return { localizedName: null, version: null }

  const findIdInName = await ConfigDBManager.getConfigValue('game.scraper.dlsite.findIdInName')
  if (!findIdInName) return { localizedName: null, version: null }

  return parseDlsiteFolderName(path.basename(dirPath))
}

export async function addGameToDBWithoutMetadata(
  dirPath: string,
  gamePath?: string
): Promise<void> {
  try {
    const dbId = generateUUID()
    // Get the game name from the path
    const gameName = path.basename(gamePath || dirPath)
    // Create a new game document with default values, deep copy to avoid mutation
    const gameDoc = JSON.parse(JSON.stringify(DEFAULT_GAME_VALUES))
    // Set the game document properties
    gameDoc._id = dbId
    gameDoc.record.addDate = new Date().toISOString()
    gameDoc.metadata.name = gameName

    // Create a new game local document with default values, deep copy to avoid mutation
    const gameLocalDoc = JSON.parse(JSON.stringify(DEFAULT_GAME_LOCAL_VALUES))
    // Set the game local document properties
    gameLocalDoc._id = dbId
    gameLocalDoc.path.gamePath = gamePath ?? ''
    gameLocalDoc.utils.markPath = dirPath ?? ''
    gameLocalDoc.utils.rootPath = inferRootPath(gameLocalDoc.utils.markPath)
    // Seed the first version so a brand new game is multi-version ready from the start.
    normalizeGameLocalDoc(gameLocalDoc, { defaultVersionName: '' })

    // Calculate storage size if enabled
    const autoCalculateSize = await isAutoCalculateStorageSizeEnabled()
    if (autoCalculateSize && gameLocalDoc.utils.rootPath) {
      gameDoc.record.storageSize = await calculateStorageSizeForPath(gameLocalDoc.utils.rootPath)
    }

    await GameDBManager.setGame(dbId, gameDoc)
    await GameDBManager.setGameLocal(dbId, gameLocalDoc)

    // Set the launcher preset and save the game icon
    if (gamePath) {
      await launcherPreset('default', dbId)
      await saveGameIconByFile(dbId, gamePath)
    }

    eventBus.emit(
      'game:added',
      {
        gameId: dbId,
        name: gameDoc.metadata.name
      },
      { source: 'adder' }
    )
  } catch (error) {
    log.error('[Adder] Failed to add game to database without metadata:', error)
    throw error
  }
}

export async function getBatchGameAdderData(): Promise<BatchGameInfo[]> {
  try {
    const dirPath = await selectPathDialog(['openDirectory'])
    if (!dirPath) {
      return []
    }
    const defaultDataSource = await ConfigDBManager.getConfigValue(
      'game.scraper.common.defaultDataSource'
    )
    // Get the subfolders in the selected directory
    const games = await getGameFolders(dirPath)
    const data = games.map(async (game) => {
      return {
        dataId: generateUUID(),
        dataSource: defaultDataSource,
        name: game.name,
        id: '',
        // Check if the game exists in the database, use dirPath
        status: ((await GameDBManager.checkGameExitsByPath(game.dirPath)) ? 'existed' : 'idle') as
          | 'existed'
          | 'idle',
        dirPath: game.dirPath
      }
    })
    return Promise.all(data)
  } catch (error) {
    log.error('[Adder] Failed to get batch game adder data:', error)
    throw error
  }
}
