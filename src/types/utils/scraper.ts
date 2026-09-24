export type GameList = {
  id: string
  name: string
  releaseDate: string
  developers: string[]
}[]

export type GameMetadata = {
  name: string
  originalName: string | null
  releaseDate: string
  description: string
  developers: string[]
  relatedSites: {
    label: string
    url: string
  }[]
  tags: string[]
  /**
   * 标签的**抓取层明细**。⚠️ 它不是游戏元数据的一部分 —— `ScraperManager` 归一完就剥掉，
   * 绝不会写进游戏文档。只有「标签文本随语言变」的源才需要填（目前是 DLsite）。
   *
   * 存在的理由：DLsite 用 `?locale=` 请求作品页，中文界面返回「主从/主仆」、日文界面返回
   * 「主従」，而两者的 href 里带着**逐字相同**的 id（`/genre/288/`）。没有这个 id，
   * 同一条标签会在两种界面语言下裂成两条实体；有了它才能真正归并，并顺带把另一种语言的
   * 写法攒成译名。
   */
  tagsDetail?: {
    /**
     * 上游标签文本实际使用的语言（词库语言代码，如 `zh-Hans`）。
     * 省略时由词库按 provider 名推断（见 lexicon 的 `PROVIDER_LANGUAGE`）。
     */
    language?: string
    /**
     * 「原始串 → 源内稳定 id」，只列**有**稳定 id 的那些标签。
     * DLsite 的 `genre:288` / `type:RPG` / `option:SND` 在两种语言下完全一致。
     */
    ids?: {
      raw: string
      id: string
    }[]
  }
  publishers?: string[]
  genres?: string[]
  platforms?: string[]
  extra?: {
    key: string
    value: string[]
  }[]
}

export type ScraperIdentifier = {
  type: 'id' | 'name'
  value: string
}

export type GameDescriptionList = {
  dataSource: string
  description: string
}[]

export type GameTagsList = {
  dataSource: string
  tags: string[]
}[]

export type GameExtraInfoList = {
  dataSource: string
  extra: {
    key: string
    value: string[]
  }[]
}[]

export type GameDevelopersList = {
  dataSource: string
  developers: string[]
}[]

export type GamePublishersList = {
  dataSource: string
  publishers: string[]
}[]

export type GameGenresList = {
  dataSource: string
  genres: string[]
}[]

export type GamePlatformsList = {
  dataSource: string
  platforms: string[]
}[]

export type GameRelatedSitesList = {
  dataSource: string
  relatedSites: {
    label: string
    url: string
  }[]
}[]

export type GameInformationList = {
  dataSource: string
  information: {
    name?: string
    originalName?: string
    releaseDate?: string
    developers?: string[]
    publishers?: string[]
    genres?: string[]
    platforms?: string[]
  }
}[]

export type ScraperCapabilities =
  | 'searchGames'
  | 'checkGameExists'
  | 'getGameMetadata'
  | 'getGameWideCovers'
  | 'getGameBackgrounds'
  | 'getGameCovers'
  | 'getGameLogos'
  | 'getGameIcons'

// Define the type for game metadata fields which can be updated
export type GameMetadataField =
  // Basic information
  | 'name'
  | 'originalName'
  | 'releaseDate'
  | 'description'

  // Development and release information
  | 'developers'
  | 'publishers'

  // Categorization
  | 'genres'
  | 'platforms'
  | 'tags'

  // Other information
  | 'relatedSites'
  | 'extra'

  // Image resources
  | 'cover'
  | 'background'
  | 'logo'
  | 'icon'

export const AllGameMetadataUpdateFields: (GameMetadataField | GameMetadataUpdateMode)[] = [
  '#all',
  '#missing',
  'name',
  'originalName',
  'releaseDate',
  'description',
  'developers',
  'publishers',
  'genres',
  'platforms',
  'tags',
  'relatedSites',
  'extra',
  'cover',
  'background',
  'logo',
  'icon'
]

// Special update modes
export type GameMetadataUpdateMode = '#all' | '#missing'

// Define the complete update options type
export interface GameMetadataUpdateOptions {
  /**
   * Overwrite existing metadata fields
   * @default true
   */
  overwriteExisting?: boolean

  /**
   * Update image resources (when requesting to update image fields)
   * @default true
   */
  updateImages?: boolean

  /**
   * Merge strategy - Applied to array-type fields
   * - 'replace': Completely replace existing data
   * - 'append': Append new data to existing data
   * - 'merge': Merge new and old data and remove duplicates
   * @default 'merge'
   */
  mergeStrategy?: 'replace' | 'append' | 'merge'

  /**
   * Priority of data sources when updating metadata
   * @default []
   */
  sourcesPriority?: string[]
}

/**
 * Single game metadata update result
 */
export interface BatchUpdateResult {
  gameId: string
  success: boolean
  error?: string
  dataSourceId: string | null
  gameName: string | null
}

/**
 * Batch update results summary
 */
export interface BatchUpdateResults {
  totalGames: number
  successfulUpdates: number
  failedUpdates: number
  results: BatchUpdateResult[]
}

export interface BatchUpdateGameMetadataProgress {
  gameId: string
  gameName: string | null
  dataSource: string
  dataSourceId: string | null
  fields: (GameMetadataField | GameMetadataUpdateMode)[]
  options: GameMetadataUpdateOptions
  status: 'success' | 'error'
  error?: string
  current: number
  total: number
}
