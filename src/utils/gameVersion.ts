import {
  DEFAULT_GAME_LOCAL_VALUES,
  type GameLocalLauncherConfig,
  type GameLocalPathConfig,
  type GameLocalUtilsConfig,
  type GameLocalVersion,
  type gameLocalDoc
} from '@appTypes/models'

/**
 * Version ids are plain keys inside `gameLocalDoc.versions`. The id is generated, so it stays
 * stable when a version is renamed; `name` is what the user sees.
 */
export const DEFAULT_VERSION_ID = 'default'

/** Path roots inside `gameLocalDoc` that a version owns. Everything else stays global. */
const VERSION_SCOPED_ROOTS = ['path', 'launcher', 'utils'] as const

export const VERSIONS_PATH_PREFIX = 'versions.'

type VersionConfigSource = {
  path?: GameLocalPathConfig
  launcher?: GameLocalLauncherConfig
  utils?: GameLocalUtilsConfig
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function versionConfigDefaults(): {
  path: GameLocalPathConfig
  launcher: GameLocalLauncherConfig
  utils: GameLocalUtilsConfig
} {
  // The top-level defaults double as the per-version defaults, so a version block that never
  // touched a field still reads back the same shape as a legacy single-version document.
  return {
    path: deepClone(DEFAULT_GAME_LOCAL_VALUES.path),
    launcher: deepClone(DEFAULT_GAME_LOCAL_VALUES.launcher),
    utils: deepClone(DEFAULT_GAME_LOCAL_VALUES.utils)
  }
}

export function createVersionBlock(
  id: string,
  name: string,
  source?: VersionConfigSource
): GameLocalVersion {
  const defaults = versionConfigDefaults()
  return {
    id,
    name,
    path: source?.path ? deepClone(source.path) : defaults.path,
    launcher: source?.launcher ? deepClone(source.launcher) : defaults.launcher,
    utils: source?.utils ? deepClone(source.utils) : defaults.utils
  }
}

/**
 * Whether a `gameLocalDoc` path belongs to a version rather than to the document as a whole.
 * Used to route reads/writes through `versions.<id>.*` while a version scope is active.
 */
export function isVersionScopedPath(path: string): boolean {
  if (path.startsWith(VERSIONS_PATH_PREFIX)) return false
  return VERSION_SCOPED_ROOTS.some((root) => path === root || path.startsWith(`${root}.`))
}

/** Map a document path onto a specific version, e.g. `path.gamePath` -> `versions.a1.path.gamePath`. */
export function toVersionPath(path: string, versionId: string): string {
  return `${VERSIONS_PATH_PREFIX}${versionId}.${path}`
}

/**
 * Fall back from a version path to the document defaults, so a version block that never set a
 * field resolves to the same value a legacy document would have had.
 * `versions.a1.path.gamePath` -> `path.gamePath` in `DEFAULT_GAME_LOCAL_VALUES`.
 */
export function stripVersionPath(path: string): string | null {
  if (!path.startsWith(VERSIONS_PATH_PREFIX)) return null
  const rest = path.slice(VERSIONS_PATH_PREFIX.length)
  const separatorIndex = rest.indexOf('.')
  if (separatorIndex === -1) return null
  return rest.slice(separatorIndex + 1)
}

/**
 * Copy the active version's three blocks onto the top level.
 *
 * The top level is what the whole main process reads (launcher, monitor, save scanning, storage
 * size, rootPath inference), so it must always describe `currentVersionId`. Returns whether the
 * top level actually changed.
 */
export function applyActiveVersionMirror(doc: gameLocalDoc): boolean {
  const active = doc.versions?.[doc.currentVersionId]
  if (!active) return false

  const defaults = versionConfigDefaults()
  const nextPath = active.path ? deepClone(active.path) : defaults.path
  const nextLauncher = active.launcher ? deepClone(active.launcher) : defaults.launcher
  const nextUtils = active.utils ? deepClone(active.utils) : defaults.utils

  const changed =
    JSON.stringify(doc.path) !== JSON.stringify(nextPath) ||
    JSON.stringify(doc.launcher) !== JSON.stringify(nextLauncher) ||
    JSON.stringify(doc.utils) !== JSON.stringify(nextUtils)

  if (changed) {
    doc.path = nextPath
    doc.launcher = nextLauncher
    doc.utils = nextUtils
  }

  return changed
}

/**
 * Make a `gameLocalDoc` self-consistent: at least one version exists, `currentVersionId` points at
 * a real one, every block carries the three config objects, and the top-level mirror matches.
 *
 * Documents written before multi-version support have no `versions` at all — their top-level blocks
 * become the first version, so old data keeps working without an explicit migration.
 *
 * Mutates `doc` and reports whether anything was repaired.
 */
export function normalizeGameLocalDoc(
  doc: gameLocalDoc,
  options: { defaultVersionName?: string } = {}
): boolean {
  let changed = false
  const defaults = versionConfigDefaults()

  if (!isPlainObject(doc.versions)) {
    doc.versions = {}
    changed = true
  }

  if (Object.keys(doc.versions).length === 0) {
    doc.versions[DEFAULT_VERSION_ID] = createVersionBlock(
      DEFAULT_VERSION_ID,
      options.defaultVersionName ?? '',
      {
        path: isPlainObject(doc.path) ? doc.path : undefined,
        launcher: isPlainObject(doc.launcher) ? doc.launcher : undefined,
        utils: isPlainObject(doc.utils) ? doc.utils : undefined
      }
    )
    changed = true
  }

  for (const [versionId, version] of Object.entries(doc.versions)) {
    if (!isPlainObject(version)) {
      delete doc.versions[versionId]
      changed = true
      continue
    }
    if (version.id !== versionId) {
      version.id = versionId
      changed = true
    }
    if (typeof version.name !== 'string') {
      version.name = ''
      changed = true
    }
    if (!isPlainObject(version.path)) {
      version.path = deepClone(defaults.path)
      changed = true
    }
    if (!isPlainObject(version.launcher)) {
      version.launcher = deepClone(defaults.launcher)
      changed = true
    }
    if (!isPlainObject(version.utils)) {
      version.utils = deepClone(defaults.utils)
      changed = true
    }
  }

  if (!doc.currentVersionId || !doc.versions[doc.currentVersionId]) {
    doc.currentVersionId = Object.keys(doc.versions)[0]
    changed = true
  }

  if (applyActiveVersionMirror(doc)) changed = true

  return changed
}

/** Ordered list of a document's versions, falling back to insertion order. */
export function listVersions(doc: gameLocalDoc | null): GameLocalVersion[] {
  if (!doc?.versions) return []
  return Object.values(doc.versions)
}

/**
 * Trailing version marker in a folder name: `Game v1.2`, `Game ver 1.02`, `Game [v1.2]`.
 * The leading `v` is required — a bare trailing number is indistinguishable from a title, and
 * guessing wrong would silently retarget a version.
 */
const TRAILING_VERSION_SUFFIX_REGEX = /[vV](?:er(?:sion)?)?\.?\s*(\d+(?:\.\d+)*)\s*[\])）】]?$/

/**
 * Read the version number off the end of a folder name, or `null` when it has none.
 *
 * Used by the scanner's identity fallback: `Game v1.2` should be routed to the game's `1.2`
 * version rather than to whatever version happens to be primary.
 */
export function parseVersionSuffix(folderName: string): string | null {
  if (!folderName) return null
  const match = folderName.match(TRAILING_VERSION_SUFFIX_REGEX)
  return match ? match[1] : null
}

/** `v1.2` / `Ver. 1.02` / `1.2` -> `1.2`, so a folder label and a version name can be compared. */
export function normalizeVersionLabel(label: string): string {
  if (!label) return ''
  return (
    label
      .trim()
      .replace(/^[vV](?:er(?:sion)?)?\.?\s*/, '')
      // Trailing separators arrive from labels like `1.2 (beta)` or `1.2-`.
      .replace(/[\s\-_]+$/, '')
      .toLowerCase()
  )
}

/**
 * Version a folder without a version label belongs to: the `default` slot when it still exists,
 * otherwise whatever the document currently launches, otherwise the first version.
 */
export function getPrimaryVersionId(doc: gameLocalDoc | null): string {
  if (!doc?.versions) return ''
  if (doc.versions[DEFAULT_VERSION_ID]) return DEFAULT_VERSION_ID
  if (doc.currentVersionId && doc.versions[doc.currentVersionId]) return doc.currentVersionId
  return Object.keys(doc.versions)[0] ?? ''
}

/** Find the version whose name (or id) matches a version label such as `1.2`. */
export function findVersionByLabel(
  doc: gameLocalDoc | null,
  label: string
): GameLocalVersion | null {
  const target = normalizeVersionLabel(label)
  if (!target || !doc?.versions) return null
  return (
    Object.values(doc.versions).find(
      (version) =>
        normalizeVersionLabel(version.name ?? '') === target ||
        normalizeVersionLabel(version.id ?? '') === target
    ) ?? null
  )
}

/**
 * Directory a version points at: its game folder when known, else the folder holding its
 * executable. Returns '' when the version carries no path at all.
 */
export function versionDirectory(version: GameLocalVersion | null | undefined): string {
  if (!version) return ''
  const markPath = (version.utils?.markPath ?? '').trim()
  if (markPath) return markPath
  const gamePath = (version.path?.gamePath ?? '').trim()
  if (!gamePath) return ''
  const normalized = gamePath.replace(/\\/g, '/')
  const lastSeparator = normalized.lastIndexOf('/')
  return lastSeparator <= 0 ? '' : normalized.slice(0, lastSeparator)
}

/**
 * Normalize a game name for identity comparison: drop bracketed noise, punctuation and case.
 * `[Circle] Game Title 2!` and `Game Title 2` collapse to the same key.
 */
export function normalizeGameIdentityKey(name: string): string {
  if (!name) return ''
  return name
    .replace(/[[(（【][^\])）】]*[\])）】]/g, ' ')
    .replace(/[_\-.·•★☆※#@^$%&+=|\\/:;"'<>,?~～!！]/g, ' ')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * Key used to decide whether two version rows point at the same directory.
 *
 * Windows paths are case-insensitive and both separators are accepted, so `D:\Games\Foo\` and
 * `d:/games/foo` are the same folder. A leading `\\` (UNC) is preserved through the separator
 * collapse so `\\nas\share\game` cannot be confused with a rooted single-slash path.
 */
export function normalizeDirectoryKey(directory: string): string {
  const trimmed = (directory ?? '').trim()
  if (!trimmed) return ''

  const unc = /^\\\\|^\/\//.test(trimmed)
  const collapsed = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')

  return (unc ? `/${collapsed}` : collapsed).toLowerCase()
}

/**
 * Clean a directory the user typed before it is stored: trim and drop trailing separators.
 *
 * Separators are deliberately left alone — this module is shared with the renderer, so it cannot
 * pull in `node:path`, and rewriting `\` to `/` (or back) would surprise a user pasting a path the
 * OS accepts verbatim.
 */
export function normalizeDirectoryForStorage(directory: string): string {
  return (directory ?? '').trim().replace(/[\\/]+$/, '')
}
