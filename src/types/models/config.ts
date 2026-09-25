import type { LauncherPreset } from './launcherPreset'
import { DEFAULT_LOCAL_UPSCALER_CONFIG, type LocalUpscalerConfig } from '../utils/upscaler'
import { defaultReportExportOptions, type ReportExportOptions } from '../report'
import type { PathConflict } from '../utils/gameConflict'
import type { VersionReviewLogEntry } from '../utils/versionReview'

export enum NSFWBlurLevel {
  Off = 0,
  BlurImage = 1,
  BlurImageAndTitle = 2
}
export enum NSFWFilterMode {
  All = 0,
  HideNSFW = 1,
  OnlyNSFW = 2
}
export enum LocalGameFilterMode {
  All = 0,
  HideLocal = 1,
  OnlyLocal = 2
}

export type GameNavElementType = 'gameIcon' | 'gameName' | 'localFlag' | 'playStatus' | 'sortInfo'
export type ReservableType = 'localFlag' | 'playStatus'
export type NonReservableType = Exclude<GameNavElementType, ReservableType>
export type GameNavElement =
  | {
      type: NonReservableType
    }
  | {
      type: ReservableType
      reserveSpace: boolean
    }

/**
 * How the library game list is rendered.
 * - `list`: compact one-line rows (game icon + name + sort info)
 * - `grid`: poster grid built from the portrait cover image
 */
export type GameListDisplayMode = 'list' | 'grid'

/**
 * Card shape used by the showcase (homepage) game lists.
 * - `portrait`: the classic 2:3 cover poster (148x222)
 * - `wide`: the 3:2 wide cover poster, same height but much wider (333x222)
 *
 * Both shapes share the same image height, so switching only changes the number
 * of columns per row, not the row height.
 */
export type PosterShape = 'portrait' | 'wide'

export interface configDocs {
  general: {
    openAtLogin: boolean
    quitToTray: boolean
    language: string
    hideWindowAfterGameStart: boolean
    showWindowAfterGameExit: boolean
    enableForegroundTimer: boolean
    foregroundWaitTime: number
    ignoreShortInterruptions: number
    ignoreShortSessions: number
  }
  game: {
    scraper: {
      common: {
        defaultDataSource: 'steam' | 'vndb' | 'bangumi' | 'ymgal' | 'igdb' | 'dlsite' | string
        defaultMediaDataSource: 'google' | string
        cacheDescriptionImages: boolean
      }
      vndb: {
        tagSpoilerLevel: 0 | 1 | 2
      }
      dlsite: {
        findIdInName: boolean
      }
    }
    showcase: {
      sort: {
        by:
          | 'metadata.name'
          | 'metadata.sortName'
          | 'metadata.releaseDate'
          | 'record.lastRunDate'
          | 'record.addDate'
          | 'record.playTime'
          | 'record.score'
          | 'record.storageSize'
        order: 'asc' | 'desc'
      }
      posterShape: PosterShape
    }
    gameList: {
      sort: {
        by:
          | 'metadata.name'
          | 'metadata.sortName'
          | 'metadata.releaseDate'
          | 'record.lastRunDate'
          | 'record.addDate'
          | 'record.playTime'
          | 'record.score'
          | 'record.storageSize'
        order: 'asc' | 'desc'
      }
      groupSortSummary: {
        by: 'none' | 'record.playTime' | 'record.score' | 'record.storageSize'
        followSort: boolean
      }
      overrideCollectionSort: boolean
      selectedGroup:
        | 'none'
        | 'collection'
        | 'metadata.genres'
        | 'metadata.developers'
        | 'record.playStatus'
      highlightLocalGames: boolean
      warnInvalidGamePaths: boolean
      showRecentGames: boolean
      showAllGamesInGroup: boolean
      gameNavStyle: GameNavElement[]
      displayMode: GameListDisplayMode
    }
    gameHeader: {
      showOriginalName: boolean
    }
    randomGameRule: string
  }
  appearances: {
    sidebar: {
      showThemeSwitcher: boolean
      showNSFWBlurSwitcher: boolean
      showLocalGameFilterSwitcher: boolean
      showCustomVisibilityFilterSwitcher: boolean
      showToolbox: boolean
    }
    background: {
      customBackground: boolean
    }
    showcase: {
      showPlayButtonOnPoster: boolean
    }
    scrollbar: {
      blur: number
      opacity: number
    }
    gameDetail: {
      headerLayout: 'default' | 'compact'
      glassBackgroundImage: 'background' | 'cover' | 'logo'
      showHeaderImage: boolean
      headerImageMaxHeight: number
      showCover: boolean
      showLogo: boolean
      contentTopPadding: number
    }
    memory: {
      sortOrder: 'asc' | 'desc'
      gridColumnWidth: number
      masonryColumnWidth: number
      fullColumnWidth: number
      showAddCoverHoverButton: boolean
      showAddNoteHoverButton: boolean
      /** Number of items per page for each view; 0 disables pagination. */
      gridItemsPerPage: number
      masonryItemsPerPage: number
      listItemsPerPage: number
      fullItemsPerPage: number
    }
    glass: {
      dark: {
        blur: number
        opacity: number
      }
      light: {
        blur: number
        opacity: number
      }
    }
    nsfwBlurLevel: NSFWBlurLevel
    nsfwFilterMode: NSFWFilterMode
    localGameFilterMode: LocalGameFilterMode
    customVisibilityFilter: {
      enabled: boolean
      excludedPathPrefixes: string[]
      excludedGameNames: string[]
    }
    fonts: {
      family: string
      size: number
      weight: number
    }
  }
  hotkeys: {
    library: string
    record: string
    scanner: string
    config: string
    goBack: string
    goForward: string
    addGame: string
    randomGame: string
  }
  updater: {
    allowPrerelease: boolean
  }
  metadata: {
    transformer: {
      enabled: boolean
      list: {
        id: string
        name: string
        note: string
        processors: {
          name: {
            match: string[]
            replace: string
          }[]
          originalName: {
            match: string[]
            replace: string
          }[]
          description: {
            match: string[]
            replace: string
          }[]
          developers: {
            match: string[]
            replace: string
          }[]
          publishers: {
            match: string[]
            replace: string
          }[]
          platforms: {
            match: string[]
            replace: string
          }[]
          genres: {
            match: string[]
            replace: string
          }[]
          tags: {
            match: string[]
            replace: string
          }[]
          director: {
            match: string[]
            replace: string
          }[]
          scenario: {
            match: string[]
            replace: string
          }[]
          illustration: {
            match: string[]
            replace: string
          }[]
          music: {
            match: string[]
            replace: string
          }[]
          engine: {
            match: string[]
            replace: string
          }[]
        }
      }[]
    }
    autoCalculateStorageSize: boolean
  }
  memory: {
    image: {
      saveToClipboard: boolean
      autoFillNoteFromFilename: boolean
    }
    enableNotificationSound: boolean
  }
  record: {
    dayBoundaryHour: number
    weekly: {
      mergeInterval: number
    }
    monthly: {
      useAlternateColor: boolean
    }
    yearly: {
      hideLowPercentType: boolean
    }
  }
}

export interface configLocalDocs {
  report: ReportExportOptions
  userInfo: {
    name: string
    email: string
    role: string
    accessToken: string
    refreshToken: string
  }
  sync: {
    enabled: boolean
    mode: 'official' | 'selfHosted'
    officialConfig: {
      auth: {
        username: string
        password: string
      }
    }
    selfHostedConfig: {
      url: string
      auth: {
        username: string
        password: string
      }
    }
  }
  hotkeys: {
    captureRectangle: string
    captureActiveWindow: string
    captureFullscreen: string
  }
  game: {
    // Bangumi credentials. Kept in the local (unsynced) config because the token unlocks the
    // user's own NSFW-visible content and must never be pushed to the cloud.
    scraper: {
      bangumi: {
        /** Personal access token, or the access token obtained through OAuth. Empty when unconfigured. */
        accessToken: string
        /** Only set by the OAuth flow; empty for a manually pasted personal token. */
        refreshToken: string
        /** Unix ms. 0 means "no known expiry" — personal tokens last about a year. */
        expiresAt: number
        /** Bangumi username resolved from /v0/me, so the settings page can show who is connected. */
        userName: string
      }
    }
    launcher: {
      presets: LauncherPreset[]
    }
    linkage: {
      localeEmulator: {
        path: string
      }
      visualBoyAdvance: {
        path: string
      }
      magpie: {
        path: string
        hotkey: string
      }
      upscaler: {
        path: string
        config: LocalUpscalerConfig
      }
    }
    scanner: {
      interval: number
      ignoreList: string[]
      list: {
        [key: string]: {
          path: string
          dataSource: 'steam' | 'vndb' | 'bangumi' | 'ymgal' | 'igdb' | 'dlsite' | string
          scanMode?: 'auto' | 'hierarchy'
          hierarchyLevel?: number
          // Backward compatibility for old configs
          depth?: number
          deepth?: number
          targetCollection: string
          normalizeFolderName?: boolean
          upscaleScale?: number
          // Mark every game added by this scanner as NSFW. Absent in older configs (= false).
          nsfw?: boolean
        }
      }
    }
    // Path conflicts raised by the scanner's identity fallback. Kept in the local (unsynced) config
    // because the paths themselves are machine-specific.
    pathConflicts: PathConflict[]
    // What the version workbench did to each game (folders ignored or adopted, entries merged), so
    // the user can review it and undo an ignore. Local for the same reason as `pathConflicts`.
    versionLog: VersionReviewLogEntry[]
  }
  database: {
    defaultBackupPath: string
    migrationCompleted: string[]
  }
  memory: {
    image: {
      storageBackend: 'filesystem' | 'database' | 'both'
      saveDir: string
      namingRule: string
    }
  }
  network: {
    proxy: {
      enable: boolean
      protocol: 'http' | 'https' | 'socks4' | 'socks5'
      host: string
      port: number
      bypassRules: string
    }
  }
  toolbox: {
    tools: {
      [id: string]: {
        name: string
        path: string
        args: string
        workingDirectory: string
      }
    }
  }
}

export const DEFAULT_CONFIG_VALUES: Readonly<configDocs> = {
  general: {
    openAtLogin: false,
    quitToTray: false,
    language: '',
    hideWindowAfterGameStart: true,
    // 默认延续现有版本的退出行为，升级后仍会显示并聚焦主窗口，用户可在设置中关闭。
    showWindowAfterGameExit: true,
    enableForegroundTimer: true,
    foregroundWaitTime: 10,
    ignoreShortInterruptions: 0,
    ignoreShortSessions: 0
  },
  game: {
    scraper: {
      common: {
        defaultDataSource: 'steam',
        defaultMediaDataSource: 'google',
        cacheDescriptionImages: false
      },
      vndb: {
        tagSpoilerLevel: 0
      },
      dlsite: {
        findIdInName: false
      }
    },
    showcase: {
      sort: {
        by: 'metadata.name',
        order: 'desc' as const
      },
      posterShape: 'portrait' as const
    },
    gameList: {
      sort: {
        by: 'metadata.name',
        order: 'desc' as const
      },
      groupSortSummary: {
        by: 'none',
        followSort: true
      },
      overrideCollectionSort: false,
      selectedGroup: 'collection',
      highlightLocalGames: true,
      warnInvalidGamePaths: true,
      showRecentGames: true,
      showAllGamesInGroup: true,
      gameNavStyle: [
        { type: 'gameIcon' },
        { type: 'gameName' },
        { type: 'sortInfo' },
        { type: 'localFlag', reserveSpace: false }
      ],
      displayMode: 'grid'
    },
    gameHeader: {
      showOriginalName: false
    },
    randomGameRule: `{ "gameNameNot": [] }`
  },
  appearances: {
    sidebar: {
      showThemeSwitcher: true,
      showNSFWBlurSwitcher: true,
      showLocalGameFilterSwitcher: true,
      showCustomVisibilityFilterSwitcher: false,
      showToolbox: true
    },
    background: {
      customBackground: true
    },
    showcase: {
      showPlayButtonOnPoster: true
    },
    scrollbar: {
      blur: 32,
      opacity: 0.7
    },
    gameDetail: {
      headerLayout: 'default',
      glassBackgroundImage: 'background',
      showHeaderImage: true,
      headerImageMaxHeight: 55, // in vh
      showCover: true,
      showLogo: true,
      contentTopPadding: 40 // in vh
    },
    memory: {
      sortOrder: 'desc',
      gridColumnWidth: 280,
      masonryColumnWidth: 220,
      fullColumnWidth: 320,
      showAddCoverHoverButton: true,
      showAddNoteHoverButton: true,
      gridItemsPerPage: 12,
      masonryItemsPerPage: 20,
      listItemsPerPage: 20,
      fullItemsPerPage: 24
    },
    glass: {
      dark: {
        blur: 130,
        opacity: 0.3
      },
      light: {
        blur: 130,
        opacity: 0.9
      }
    },
    // NSFW covers start out blurred: the library tag (`game.apperance.nsfw`) is enough of a signal
    // that the art should not be on screen by default. The titlebar toggle turns it off per click.
    nsfwBlurLevel: NSFWBlurLevel.BlurImage,
    nsfwFilterMode: NSFWFilterMode.All,
    localGameFilterMode: LocalGameFilterMode.All,
    customVisibilityFilter: {
      enabled: false,
      excludedPathPrefixes: [],
      excludedGameNames: []
    },
    fonts: {
      family: 'LXGW WenKai Mono',
      size: 1, // in rem
      weight: 400
    }
  },
  hotkeys: {
    library: 'alt+shift+l',
    record: 'alt+shift+r',
    scanner: 'alt+shift+s',
    config: 'alt+shift+c',
    goBack: 'alt+left',
    goForward: 'alt+right',
    addGame: 'alt+shift+a',
    randomGame: 'ctrl+shift+r'
  },
  updater: {
    allowPrerelease: false
  },
  metadata: {
    transformer: {
      enabled: true,
      list: [
        {
          id: 'default',
          name: 'Default',
          note: 'Default transformer',
          processors: {
            name: [],
            originalName: [],
            description: [],
            developers: [],
            publishers: [],
            platforms: [],
            genres: [],
            tags: [],
            director: [],
            scenario: [],
            illustration: [],
            music: [],
            engine: []
          }
        }
      ]
    },
    autoCalculateStorageSize: false
  },
  memory: {
    image: {
      saveToClipboard: false,
      autoFillNoteFromFilename: false
    },
    enableNotificationSound: true
  },
  record: {
    dayBoundaryHour: 0,
    weekly: {
      mergeInterval: 0
    },
    monthly: {
      useAlternateColor: true
    },
    yearly: {
      hideLowPercentType: true
    }
  }
} as const

export const DEFAULT_CONFIG_LOCAL_VALUES: Readonly<configLocalDocs> = {
  report: defaultReportExportOptions,
  database: {
    defaultBackupPath: '',
    migrationCompleted: []
  },
  memory: {
    image: {
      storageBackend: 'database',
      saveDir: '',
      namingRule: '%datetime%'
    }
  },
  userInfo: {
    name: '',
    email: '',
    role: 'community',
    accessToken: '',
    refreshToken: ''
  },
  sync: {
    enabled: false,
    mode: 'official',
    officialConfig: {
      auth: {
        username: '',
        password: ''
      }
    },
    selfHostedConfig: {
      url: '',
      auth: {
        username: '',
        password: ''
      }
    }
  },
  hotkeys: {
    captureRectangle: '',
    captureActiveWindow: 'alt+shift+z',
    captureFullscreen: ''
  },
  game: {
    scraper: {
      bangumi: {
        accessToken: '',
        refreshToken: '',
        expiresAt: 0,
        userName: ''
      }
    },
    launcher: {
      presets: [] as LauncherPreset[]
    },
    linkage: {
      localeEmulator: {
        path: ''
      },
      visualBoyAdvance: {
        path: ''
      },
      magpie: {
        path: '',
        hotkey: 'win+shift+a'
      },
      upscaler: {
        path: '',
        config: DEFAULT_LOCAL_UPSCALER_CONFIG
      }
    },
    scanner: {
      interval: 15 * 60 * 1000,
      ignoreList: [],
      list: {} as {
        [key: string]: {
          path: string
          dataSource: 'steam' | 'vndb' | 'bangumi' | 'ymgal' | 'igdb' | 'dlsite'
          scanMode?: 'auto' | 'hierarchy'
          hierarchyLevel?: number
          depth?: number
          deepth?: number
          targetCollection: string
          normalizeFolderName?: boolean
          upscaleScale?: number
          nsfw?: boolean
        }
      }
    },
    pathConflicts: [] as PathConflict[],
    versionLog: [] as VersionReviewLogEntry[]
  },
  network: {
    proxy: {
      enable: false,
      protocol: 'http',
      host: '',
      port: 0,
      bypassRules: '<local>,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fd00::/8'
    }
  },
  toolbox: {
    tools: {} as {
      [id: string]: {
        name: string
        path: string
        args: string
        workingDirectory: string
      }
    }
  }
} as const
