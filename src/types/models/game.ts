import { Paths } from 'type-fest'

export type GameMediaType = 'cover' | 'background' | 'icon' | 'logo' | 'wideCover'

export type GameMemoryViewMode = 'grid' | 'full' | 'masonry' | 'list'

export type gameDocs = {
  [gameId: string]: gameDoc
}

export interface gameDoc {
  _id: string
  metadata: {
    name: string
    originalName: string
    sortName: string
    /**
     * Free-form version of this copy of the game, e.g. `1.02` or `v2 (汉化)`. Edited by hand in
     * the information dialog, never filled by a scraper: the data sources have no such field.
     */
    version: string
    releaseDate: string
    description: string
    developers: string[]
    publishers: string[]
    platforms: string[]
    genres: string[]
    tags: string[]
    relatedSites: {
      label: string
      url: string
    }[]
    steamId: string
    vndbId: string
    igdbId: string
    ymgalId: string
    extra: {
      key: string
      value: string[]
    }[]
  }
  record: {
    addDate: string
    lastRunDate: string
    score: number
    playTime: number
    playStatus: 'unplayed' | 'playing' | 'partial' | 'finished' | 'multiple' | 'shelved'
    hideFromRecentGames: boolean
    timers: {
      start: string
      end: string
    }[]
    dailyPlayTimes: {
      date: string
      playTime: number
    }[]
    storageSize: number
  }
  save: {
    saveList: {
      [saveId: string]: {
        _id: string
        date: string
        note: string
        locked: boolean
      }
    }
    maxBackups: number
    autoRestoreSave: boolean
  }
  memory: {
    preferences: {
      viewMode: GameMemoryViewMode | null
    }
    memoryList: {
      [memoryId: string]: {
        _id: string
        date: string
        note: string
        pinned?: boolean
      }
    }
  }
  apperance: {
    logo: {
      position: {
        x: number
        y: number
      }
      size: number
      visible: boolean
    }
    nsfw: boolean
  }
}

export interface gameCollectionDocs {
  [gameCollectionId: string]: gameCollectionDoc
}

export interface gameCollectionDoc {
  _id: string
  name: string
  sort: number
  sortBy:
    | 'metadata.name'
    | 'metadata.sortName'
    | 'metadata.releaseDate'
    | 'record.lastRunDate'
    | 'record.addDate'
    | 'record.playTime'
    | 'record.storageSize'
    | 'custom'
  sortOrder: 'asc' | 'desc'
  games: string[]
}

export interface gameLocalDocs {
  [gameId: string]: gameLocalDoc
}

export type GameMonitorMode = 'file' | 'folder' | 'process'

export type GameLauncherMode = 'file' | 'url' | 'script'

export interface GameLocalPathConfig {
  gamePath: string
  savePaths: string[]
  screenshotPath?: string
}

export interface GameLocalFileConfig {
  path: string
  args: string[]
  monitorMode: GameMonitorMode
  monitorPath: string
}

export interface GameLocalUrlConfig {
  url: string
  browserPath: string
  monitorMode: GameMonitorMode
  monitorPath: string
}

export interface GameLocalScriptConfig {
  workingDirectory: string
  command: string[]
  monitorMode: GameMonitorMode
  monitorPath: string
}

export interface GameLocalLauncherConfig {
  mode: GameLauncherMode
  fileConfig: GameLocalFileConfig
  urlConfig: GameLocalUrlConfig
  scriptConfig: GameLocalScriptConfig
  useMagpie: boolean
}

export interface GameLocalUtilsConfig {
  markPath: string
  rootPath: string
}

/**
 * One install of a game. A game may exist in several copies (original / translated /
 * different release), each with its own executable, save locations and launcher setup.
 *
 * 一个版本块：该版本自己的路径、启动器与派生路径，互相独立。
 */
export interface GameLocalVersion {
  id: string
  name: string
  path: GameLocalPathConfig
  launcher: GameLocalLauncherConfig
  utils: GameLocalUtilsConfig
}

export interface GameLocalVersionMap {
  [versionId: string]: GameLocalVersion
}

export interface gameLocalDoc {
  _id: string
  /**
   * The version used to launch the game — picked on the game detail page.
   *
   * The top-level `path` / `launcher` / `utils` below are always a mirror of
   * `versions[currentVersionId]`. Main-process consumers (launcher, monitor, save
   * scanning, storage size, rootPath inference) keep reading the top level, so they
   * need no knowledge of versions at all. Keep the mirror in sync via
   * `applyActiveVersionMirror`.
   */
  currentVersionId: string
  versions: GameLocalVersionMap
  path: GameLocalPathConfig
  launcher: GameLocalLauncherConfig
  utils: GameLocalUtilsConfig
}

export const DEFAULT_GAME_LOCAL_VALUES: Readonly<gameLocalDoc> = {
  _id: '',
  currentVersionId: '',
  versions: {},
  path: {
    gamePath: '',
    savePaths: [],
    screenshotPath: ''
  },
  launcher: {
    mode: 'file',
    fileConfig: {
      path: '',
      args: [],
      monitorMode: 'folder',
      monitorPath: ''
    },
    urlConfig: {
      url: '',
      browserPath: '',
      monitorMode: 'folder',
      monitorPath: ''
    },
    scriptConfig: {
      workingDirectory: '',
      command: [],
      monitorMode: 'folder',
      monitorPath: ''
    },
    useMagpie: false
  },
  utils: {
    markPath: '',
    rootPath: ''
  }
} as const

export const DEFAULT_GAME_COLLECTION_VALUES: Readonly<gameCollectionDoc> = {
  _id: '',
  name: '',
  sort: 0,
  sortBy: 'custom',
  sortOrder: 'asc',
  games: []
} as const

/**
 * Storage size value indicating the size has not been calculated yet
 */
export const STORAGE_SIZE_NOT_CALCULATED = -1

export const DEFAULT_GAME_VALUES: Readonly<gameDoc> = {
  _id: '',
  metadata: {
    name: '',
    originalName: '',
    sortName: '',
    version: '',
    releaseDate: '',
    description: '',
    developers: [] as string[],
    publishers: [] as string[],
    platforms: [] as string[],
    genres: [] as string[],
    tags: [] as string[],
    relatedSites: [] as { label: string; url: string }[],
    steamId: '',
    vndbId: '',
    igdbId: '',
    ymgalId: '',
    extra: [] as { key: string; value: string[] }[]
  },
  record: {
    addDate: '',
    lastRunDate: '',
    score: -1,
    playTime: 0,
    playStatus: 'unplayed',
    hideFromRecentGames: false,
    timers: [],
    dailyPlayTimes: [],
    storageSize: STORAGE_SIZE_NOT_CALCULATED
  },
  save: {
    saveList: {},
    maxBackups: 7,
    autoRestoreSave: false
  },
  memory: {
    preferences: {
      viewMode: null
    },
    memoryList: {}
  },
  apperance: {
    logo: {
      position: {
        x: 1.5,
        y: 35
      },
      size: 100,
      visible: true
    },
    nsfw: false
  }
} as const

export interface SortConfig {
  by: Paths<gameDoc, { bracketNotation: true }>
  order?: 'asc' | 'desc'
}

export interface Timer {
  start: string
  end: string
}

export interface DailyPlayTime {
  date: string
  playTime: number
}

export interface MaxPlayTimeDay {
  date: string
  playTime: number
}

export const DEFAULT_PLAY_STATUS_ORDER: gameDoc['record']['playStatus'][] = [
  'unplayed',
  'playing',
  'partial',
  'finished',
  'multiple',
  'shelved'
]

export const METADATA_EXTRA_PREDEFINED_KEYS = [
  'director',
  'scenario',
  'illustration',
  'music',
  'voice',
  'engine'
]

export interface BatchGameInfo {
  dataId: string
  dataSource: string
  name: string
  id: string
  status: 'idle' | 'loading' | 'success' | 'error' | 'existed'
  dirPath: string
}

export enum TimerStatus {
  Resumed,
  Paused
}

export interface GameTimerStatus {
  name: string
  status: TimerStatus
}
