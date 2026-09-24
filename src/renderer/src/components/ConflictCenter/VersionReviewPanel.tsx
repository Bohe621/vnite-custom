import type {
  PathConflictKind,
  VersionReviewDetail,
  VersionReviewSavePayload
} from '@appTypes/utils'
import { DEFAULT_VERSION_ID, normalizeDirectoryKey } from '@appUtils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { GameImage } from '~/components/ui/game-image'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { useVersionConflictStore } from '~/stores/versionConflictStore'
import { cn } from '~/utils'

interface EditableVersion {
  /** `originGameId:id` — unique even when two entries ship the same version id. */
  key: string
  id: string
  /** Entry the version was read from; another entry's id means it joins on save. */
  originGameId: string
  /** Folder name of that entry — the only label that tells same-titled duplicates apart. */
  originLabel: string
  name: string
  path: string
  gamePath: string
}

interface EditableIncoming {
  key: string
  conflictId: string
  name: string
  path: string
  /** Version whose launcher/tracking settings the new version inherits. */
  seedVersionId: string
  kind: PathConflictKind
}

interface DroppedIncoming {
  conflictId: string
  path: string
}

interface RowStatus {
  kind: 'ok' | 'missing' | 'duplicate'
  /** Row this one collides with, for the tooltip. */
  duplicateWith?: string
}

/**
 * What kind of thing a row's conflict is about, which decides who has to be fixed.
 *
 * The right-hand end of a row already reports the *state* (`目录不存在`, `与「…」目录相同`); these say
 * which layer the problem sits on — the library entry, the directory, or the versions themselves.
 */
type ConflictTag =
  /** The row belongs to a second library entry for the same product. */
  | 'library'
  /** The row's directory is gone. */
  | 'directory'
  /** Another row claims the same directory. */
  | 'version'

const versionKey = (originGameId: string, id: string): string => `${originGameId}:${id}`

/** Row id of a conflict in the local list. Derived from the conflict, so it survives a refresh. */
const incomingKey = (conflictId: string): string => `incoming:${conflictId}`

/** Last path segment, without pulling node's `path` into the renderer. */
function baseName(targetPath: string): string {
  const trimmed = targetPath.replace(/[\\/]+$/, '')
  const segments = trimmed.split(/[\\/]/)
  return segments[segments.length - 1] || targetPath
}

/**
 * Name to pre-fill for a folder waiting to be adopted.
 *
 * The main process resolves this from the conflict (`incomingLabel`): the version marker in the
 * folder name, else the id of the slot the scanner routed it to (`default`). Nothing about the
 * *directory* belongs here — a folder name says nothing about which version the folder is about to
 * become, and a long one fills the whole input. The fallback below only covers a conflict written
 * by a build that predates this.
 */
function incomingName(label?: string): string {
  const trimmed = (label ?? '').trim()
  return trimmed || DEFAULT_VERSION_ID
}

/** Version rows as a freshly read review describes them. */
function versionRowsOf(detail: VersionReviewDetail | null): EditableVersion[] {
  return (detail?.versions ?? []).map((version) => ({
    key: versionKey(version.originGameId, version.id),
    id: version.id,
    originGameId: version.originGameId,
    originLabel: baseName(version.originDirectory) || version.originTitle,
    name: version.name,
    path: version.path,
    gamePath: version.gamePath
  }))
}

/** Conflict rows as a freshly read review describes them. */
function incomingRowsOf(detail: VersionReviewDetail | null): EditableIncoming[] {
  return (detail?.incoming ?? []).map((entry) => ({
    key: incomingKey(entry.conflictId),
    conflictId: entry.conflictId,
    name: incomingName(entry.label),
    path: entry.path,
    seedVersionId: entry.targetVersionId,
    kind: entry.kind
  }))
}

/**
 * Existence as the review already knows it, for the rows it could answer for (versions).
 *
 * Conflict rows are not in here: the review does not carry an existence flag for them, so they are
 * filled in by the probe that runs right after a read.
 */
function knownPathsOf(detail: VersionReviewDetail | null): Record<string, boolean> {
  return Object.fromEntries(
    (detail?.versions ?? []).map((version) => [version.path.trim(), version.pathExists])
  )
}

/** Every directory either kind of row points at, deduplicated and trimmed. */
function pathsIn(detail: VersionReviewDetail | null): string[] {
  return Array.from(
    new Set(
      [
        ...(detail?.versions ?? []).map((row) => row.path),
        ...(detail?.incoming ?? []).map((row) => row.path)
      ]
        .map((value) => value.trim())
        .filter(Boolean)
    )
  )
}

/** i18n keys for the conflict tags, written out so the key type stays literal. */
const CONFLICT_TAG_LABEL: Record<ConflictTag, string> = {
  library: 'versionConflict.conflictTags.library',
  directory: 'versionConflict.conflictTags.directory',
  version: 'versionConflict.conflictTags.version'
}

/**
 * Which layers a row's problems sit on, outermost first.
 *
 * A row from another library entry is a *library* conflict even when its folder is perfectly fine:
 * what is duplicated is the entry itself. Past that, `missing` and `duplicate` are told apart rather
 * than both filed under "folder" — one is a directory that is not there, the other is two versions
 * claiming one directory, and they need different fixes.
 */
function conflictTagsOf(params: {
  /** The row comes from a library entry other than the one being edited. */
  fromOtherEntry: boolean
  status: RowStatus | undefined
}): ConflictTag[] {
  const tags: ConflictTag[] = []
  if (params.fromOtherEntry) tags.push('library')
  if (params.status?.kind === 'missing') tags.push('directory')
  if (params.status?.kind === 'duplicate') tags.push('version')
  return tags
}

/**
 * The version editor for one game.
 *
 * Everything the user can touch lives in local state and is validated on every keystroke: a row is
 * red when its directory is gone or when another row already claims it. Nothing is written until
 * 保存, which sends the complete list in one call.
 */
export function VersionReviewPanel({
  gameId,
  onBack
}: {
  gameId: string
  onBack: () => void
}): React.JSX.Element {
  const { t } = useTranslation('adder')
  const getDetail = useVersionConflictStore((state) => state.getDetail)
  const refreshDetail = useVersionConflictStore((state) => state.refreshDetail)
  const checkPaths = useVersionConflictStore((state) => state.checkPaths)
  const saveReview = useVersionConflictStore((state) => state.save)

  const [detail, setDetail] = useState<VersionReviewDetail | null>(null)
  const [versions, setVersions] = useState<EditableVersion[]>([])
  const [incoming, setIncoming] = useState<EditableIncoming[]>([])
  const [dropped, setDropped] = useState<DroppedIncoming[]>([])
  // Rejecting a folder means "I don't want this copy", so remembering that is the default. The
  // switch stays available for the case where the user only wants it out of the way for now.
  const [ignoreFolder, setIgnoreFolder] = useState(true)
  const [pathExists, setPathExists] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  /**
   * Put a review on screen, replacing whatever is there.
   *
   * Everything the user *typed* goes. Refreshing is a read, and a half-typed path is precisely what
   * would leave the panel disagreeing with the library it just re-read — including the paths, which
   * is the whole point: existence is judged from what storage says, not from what is on screen.
   *
   * `dropped` survives, filtered to the conflicts still in storage. Rejecting a folder is a decision
   * rather than text, it only takes effect on save, and re-reading must not hand the user back the
   * rows they dismissed.
   */
  const applyDetail = useCallback(
    (next: VersionReviewDetail | null, keepDropped: DroppedIncoming[]): void => {
      const alive = new Set((next?.incoming ?? []).map((entry) => entry.conflictId))
      const kept = keepDropped.filter((row) => alive.has(row.conflictId))
      const rejected = new Set(kept.map((row) => row.conflictId))

      setDetail(next)
      setVersions(versionRowsOf(next))
      setIncoming(incomingRowsOf(next).filter((row) => !rejected.has(row.conflictId)))
      setDropped(kept)
      // Rows the review could not answer for (the conflict rows) are left unprobed rather than
      // guessed at; the probe below fills them in.
      setPathExists(knownPathsOf(next))
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    void (async () => {
      const loaded = await getDetail(gameId)
      if (cancelled) return

      applyDetail(loaded, [])
      // `ignoreFolder` is deliberately not reset here: every visit mounts a fresh panel (the
      // dialog keys it by game id), so the initial value above already applies, and keeping the
      // user's choice if this effect ever re-runs is the friendlier behaviour.
      setIsLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [gameId, getDetail, applyDetail])

  // Re-probe the disk shortly after the user stops typing. `pathExists` is keyed by the trimmed
  // path so a lookup never depends on how the user happened to space it. Note what this does *not*
  // cover: it only fires when a path changes here, so a folder deleted outside the app is invisible
  // to it — that is what `handleRefresh` (the header button) is for.
  const pathSignature = [...versions.map((row) => row.path), ...incoming.map((row) => row.path)]
    .map((value) => value.trim())
    .join('\n')

  useEffect(() => {
    const paths = Array.from(new Set(pathSignature.split('\n').filter(Boolean)))
    if (paths.length === 0) return

    let cancelled = false
    const timer = setTimeout(() => {
      void checkPaths(paths).then((result) => {
        if (cancelled) return
        setPathExists((previous) => ({ ...previous, ...result }))
      })
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pathSignature, checkPaths])

  /**
   * Toast for a refresh that also cleaned something up.
   *
   * What was let go of is spelled out: this button is the one place in the panel where rows vanish
   * without the user asking for them one by one, so it has to say exactly which ones.
   */
  const prunedToast = (folders: string[], entries: string[]): void => {
    const lines = [
      entries.length > 0
        ? t('versionConflict.notification.prunedEntries', { names: entries.join('、') })
        : '',
      folders.length > 0
        ? t('versionConflict.notification.prunedFolders', { names: folders.join('、') })
        : ''
    ].filter(Boolean)

    toast.success(
      t('versionConflict.notification.refreshedPruned', { count: entries.length + folders.length }),
      { description: lines.join('\n') }
    )
  }

  /**
   * Re-read this game from the library and rebuild the panel from what comes back.
   *
   * A conflicting copy is normally inspected first (在资源管理器中打开) and then deleted by hand, and
   * the panel would be the last thing to hear about it: nothing re-reads anything while the dialog
   * is open, and the automatic probe only fires when a path changes *here*.
   *
   * The main process deletes what the disk has already settled (`refreshVersionReview`): conflict
   * records whose folder is gone, and duplicate entries with no directory left at all. What comes
   * back is applied wholesale — see `applyDetail` — so the panel ends up agreeing with the library
   * rather than with a mixture of both.
   */
  const handleRefresh = async (): Promise<void> => {
    if (isRefreshing) return
    setIsRefreshing(true)

    try {
      const result = await refreshDetail(gameId)
      if (!result) return

      const { removedFolders, removedEntries, detail: fresh } = result
      const cleaned = removedFolders.length > 0 || removedEntries.length > 0

      if (!fresh) {
        // Nothing left for this game to decide: the cleanup took the last of it (or the group was
        // settled elsewhere while the panel was open). Its card is gone from the overview too — the
        // store already has the new list — so go back to it.
        if (cleaned) prunedToast(removedFolders, removedEntries)
        setIsRefreshing(false)
        onBack()
        return
      }

      applyDetail(fresh, dropped)

      // Probe from the freshly read review rather than from local state: a conflict that only
      // appeared now has no existence flag yet, and a row whose directory was deleted meanwhile must
      // not keep the green light the previous probe gave it.
      const paths = pathsIn(fresh)
      if (paths.length > 0) setPathExists(await checkPaths(paths))

      if (cleaned) prunedToast(removedFolders, removedEntries)
      else toast.success(t('versionConflict.notification.refreshed'))
    } finally {
      setIsRefreshing(false)
    }
  }

  const rows = useMemo(
    () => [
      ...versions.map((row) => ({
        key: row.key,
        label: row.name.trim() || t('versionConflict.versions.unnamed'),
        path: row.path
      })),
      ...incoming.map((row) => ({
        key: row.key,
        label: row.name.trim() || baseName(row.path),
        path: row.path
      }))
    ],
    [versions, incoming, t]
  )

  const rowStatus = useMemo(() => {
    const byDirectory = new Map<string, string[]>()
    for (const row of rows) {
      const key = normalizeDirectoryKey(row.path)
      if (!key) continue
      byDirectory.set(key, [...(byDirectory.get(key) ?? []), row.key])
    }

    const labelOf = new Map(rows.map((row) => [row.key, row.label]))
    const status = new Map<string, RowStatus>()

    for (const row of rows) {
      const key = normalizeDirectoryKey(row.path)
      const claimants = key ? (byDirectory.get(key) ?? []) : []

      if (claimants.length > 1) {
        const other = claimants.find((candidate) => candidate !== row.key)
        status.set(row.key, {
          kind: 'duplicate',
          duplicateWith: other ? labelOf.get(other) : undefined
        })
        continue
      }

      const trimmed = row.path.trim()
      status.set(row.key, trimmed && pathExists[trimmed] ? { kind: 'ok' } : { kind: 'missing' })
    }

    return status
  }, [rows, pathExists])

  // Only real versions are counted. A scanned folder that is gone is `missing` too, but it is not
  // a version yet, so "these versions cannot be launched" would be a lie about it.
  const missingCount = versions.filter((row) => rowStatus.get(row.key)?.kind === 'missing').length

  // The overview splits its "duplicate entries" badge the other way round too: an entry with no
  // directory left is a merge waiting to happen rather than a decision. Existence comes straight
  // from `pathExists` — a row flagged `duplicate` skipped the probe in `rowStatus`, and two entries
  // can share a directory that is gone just as easily. `pathExists` is keyed by the trimmed path,
  // which is what both the initial read and `handleRefresh` write.
  const staleMergeCount = useMemo(() => {
    const aliveByEntry = new Map<string, boolean>()
    for (const row of versions) {
      const trimmed = row.path.trim()
      const alive = Boolean(trimmed) && pathExists[trimmed] === true
      aliveByEntry.set(row.originGameId, (aliveByEntry.get(row.originGameId) ?? false) || alive)
    }
    return (detail?.mergeGameIds ?? []).filter((mergeId) => !aliveByEntry.get(mergeId)).length
  }, [versions, pathExists, detail])
  const liveMergeCount = (detail?.mergeGameIds.length ?? 0) - staleMergeCount
  // Two versions cannot share a directory: the app would launch the same folder twice and the
  // scanner would have no way to tell them apart. Missing directories are only a warning — a
  // deliberately parked version is a legitimate thing to keep.
  const hasDirectoryClash = rows.some((row) => rowStatus.get(row.key)?.kind === 'duplicate')
  const canSave = !isLoading && !isSaving && !hasDirectoryClash && rows.length > 0

  const handleSave = async (): Promise<void> => {
    if (!detail) return
    setIsSaving(true)

    const payload: VersionReviewSavePayload = {
      gameId: detail.gameId,
      versions: [
        ...versions.map((row) => ({
          id: row.id,
          name: row.name,
          path: row.path,
          gamePath: row.gamePath,
          originGameId: row.originGameId
        })),
        ...incoming.map((row) => ({
          id: '',
          name: row.name,
          path: row.path,
          gamePath: '',
          originGameId: detail.gameId,
          seedVersionId: row.seedVersionId
        }))
      ],
      adoptedConflictIds: incoming.map((row) => row.conflictId),
      droppedConflictIds: dropped.map((row) => row.conflictId),
      ignoreFolder: ignoreFolder || undefined,
      mergeGameIds: detail.mergeGameIds
    }

    const saved = await saveReview(payload)
    setIsSaving(false)
    setConfirmOpen(false)
    if (saved) onBack()
  }

  // Same call the properties page uses for its path fields (`Path/main.tsx`), so picking a folder
  // here behaves exactly like picking one there — including starting the dialog at the current
  // path. Nothing is written to the DB: the value only lands in local state and is committed by
  // 保存, which keeps "edit then verify then save" intact.
  const renderFolderPicker = (
    currentPath: string,
    apply: (picked: string) => void
  ): React.JSX.Element => (
    <Button
      variant="outline"
      size="icon"
      className="size-8 shrink-0"
      disabled={isSaving}
      title={t('versionConflict.versions.selectFolder')}
      onClick={async () => {
        const picked = await ipcManager.invoke(
          'system:select-path-dialog',
          ['openDirectory'],
          undefined,
          currentPath.trim() || undefined
        )
        if (picked) apply(picked)
      }}
    >
      <span className="icon-[mdi--folder-outline] h-4 w-4" />
    </Button>
  )

  // Same channel the game context menu uses for "browse local files"
  // (`system:open-path-in-explorer`). Kept off while the folder is known to be gone — Explorer
  // would only answer with an error dialog.
  const renderOpenInExplorer = (currentPath: string): React.JSX.Element => {
    const trimmed = currentPath.trim()
    return (
      <Button
        variant="outline"
        size="icon"
        className="size-8 shrink-0"
        disabled={isSaving || !trimmed || pathExists[trimmed] === false}
        title={t('versionConflict.versions.openInExplorer')}
        onClick={() => void ipcManager.invoke('system:open-path-in-explorer', trimmed)}
      >
        <span className="icon-[mdi--folder-open-outline] h-4 w-4" />
      </Button>
    )
  }

  const renderStatus = (key: string): React.JSX.Element => {
    const status = rowStatus.get(key)
    if (status?.kind === 'duplicate') {
      return (
        <Badge variant="destructive" className="shrink-0 text-[10px]">
          {status.duplicateWith
            ? t('versionConflict.versions.status.duplicateWith', { name: status.duplicateWith })
            : t('versionConflict.versions.status.duplicate')}
        </Badge>
      )
    }
    if (status?.kind === 'missing') {
      return (
        <Badge variant="destructive" className="shrink-0 text-[10px]">
          {t('versionConflict.versions.status.missing')}
        </Badge>
      )
    }
    return (
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('versionConflict.versions.status.ok')}
      </span>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3')}>
      {/* Header: which game, and why it is here */}
      <div className={cn('flex items-center gap-3')}>
        <Button variant="ghost" size="icon" className="shrink-0" onClick={onBack}>
          <span className="icon-[mdi--arrow-left] h-5 w-5" />
        </Button>
        <GameImage
          gameId={gameId}
          type="cover"
          fit="cover"
          className={cn('w-12 shrink-0 aspect-[2/3] rounded')}
          fallback={<div className="w-12 shrink-0 aspect-[2/3] rounded bg-muted" />}
        />
        <div className={cn('flex min-w-0 flex-col gap-1')}>
          <div className={cn('truncate font-medium')}>{detail?.title ?? ''}</div>
          <div className={cn('flex flex-wrap gap-1')}>
            {liveMergeCount > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {t('versionConflict.reason.duplicates', { entries: liveMergeCount })}
              </Badge>
            )}
            {staleMergeCount > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {t('versionConflict.reason.stale', { folders: staleMergeCount })}
              </Badge>
            )}
            {incoming.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {t('versionConflict.reason.incoming', { folders: incoming.length })}
              </Badge>
            )}
          </div>
        </div>
        {/* Right edge of the header: the only way to get the badges back in sync with a disk the
            user changed behind our back (see `handleRefresh`). */}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto shrink-0"
          title={t('versionConflict.versions.refresh')}
          disabled={isLoading || isSaving || isRefreshing}
          onClick={() => void handleRefresh()}
        >
          <span className={cn('icon-[mdi--refresh] h-5 w-5', isRefreshing && 'animate-spin')} />
        </Button>
      </div>

      {(detail?.mergeTitles.length ?? 0) > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs">
          {t('versionConflict.mergeWarning')}
          <div className="mt-1 break-all text-muted-foreground">
            {detail?.mergeTitles.join('、')}
          </div>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className={cn('flex flex-col gap-2 pr-3')}>
          {isLoading && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('versionConflict.loading')}
            </div>
          )}

          {!isLoading &&
            versions.map((row) => {
              const conflict = (rowStatus.get(row.key)?.kind ?? 'ok') !== 'ok'
              return (
                <div
                  key={row.key}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-3',
                    conflict && 'border-destructive/60 bg-destructive/5'
                  )}
                >
                  <div className={cn('flex items-center gap-2')}>
                    <Input
                      value={row.name}
                      placeholder={t('versionConflict.versions.namePlaceholder')}
                      onChange={(event) =>
                        setVersions((previous) =>
                          previous.map((item) =>
                            item.key === row.key ? { ...item, name: event.target.value } : item
                          )
                        )
                      }
                      className={cn(
                        'h-8 w-64 border border-input text-sm',
                        // The whole row is "the version in trouble": name included, not just the
                        // directory, so a glance is enough to see which versions are involved.
                        conflict && 'text-destructive'
                      )}
                    />
                    {row.originGameId !== gameId && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {t('versionConflict.versions.fromEntry', { name: row.originLabel })}
                      </Badge>
                    )}
                    {conflictTagsOf({
                      fromOtherEntry: row.originGameId !== gameId,
                      status: rowStatus.get(row.key)
                    }).map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="shrink-0 border-destructive/60 text-[10px] text-destructive"
                      >
                        {t(CONFLICT_TAG_LABEL[tag])}
                      </Badge>
                    ))}
                    <div className="ml-auto">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        title={t('versionConflict.versions.remove')}
                        onClick={() =>
                          setVersions((previous) => previous.filter((item) => item.key !== row.key))
                        }
                      >
                        <span className="icon-[mdi--trash-can-outline] h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className={cn('flex items-center gap-2')}>
                    <Input
                      value={row.path}
                      placeholder={t('versionConflict.versions.pathPlaceholder')}
                      // `Input` ships a 0-width border and paints the destructive one only for
                      // `aria-invalid`, so the red frame has to go through the attribute.
                      aria-invalid={conflict}
                      onChange={(event) =>
                        setVersions((previous) =>
                          previous.map((item) =>
                            item.key === row.key ? { ...item, path: event.target.value } : item
                          )
                        )
                      }
                      className={cn(
                        'h-8 flex-1 border border-input font-mono text-xs',
                        conflict && 'text-destructive'
                      )}
                    />
                    {renderFolderPicker(row.path, (picked) =>
                      setVersions((previous) =>
                        previous.map((item) =>
                          item.key === row.key ? { ...item, path: picked } : item
                        )
                      )
                    )}
                    {renderOpenInExplorer(row.path)}
                    {renderStatus(row.key)}
                  </div>
                </div>
              )
            })}

          {!isLoading &&
            incoming.map((row) => {
              const conflict = (rowStatus.get(row.key)?.kind ?? 'ok') === 'duplicate'
              return (
                <div
                  key={row.key}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border border-dashed p-3',
                    conflict ? 'border-destructive/60 bg-destructive/5' : 'border-primary/60'
                  )}
                >
                  <div className={cn('flex items-center gap-2')}>
                    <Badge className="shrink-0 text-[10px]">
                      {t('versionConflict.versions.incomingBadge')}
                    </Badge>
                    <Input
                      value={row.name}
                      placeholder={t('versionConflict.versions.namePlaceholder')}
                      onChange={(event) =>
                        setIncoming((previous) =>
                          previous.map((item) =>
                            item.key === row.key ? { ...item, name: event.target.value } : item
                          )
                        )
                      }
                      className="h-8 w-64 border border-input text-sm"
                    />
                    <div className="ml-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-muted-foreground"
                        onClick={() => {
                          setIncoming((previous) => previous.filter((item) => item.key !== row.key))
                          setDropped((previous) => [
                            ...previous,
                            { conflictId: row.conflictId, path: row.path }
                          ])
                        }}
                      >
                        <span className="icon-[mdi--close] mr-1 h-4 w-4" />
                        {t('versionConflict.versions.ignoreIncoming')}
                      </Button>
                    </div>
                  </div>

                  <div className={cn('flex items-center gap-2')}>
                    <Input
                      value={row.path}
                      aria-invalid={conflict}
                      onChange={(event) =>
                        setIncoming((previous) =>
                          previous.map((item) =>
                            item.key === row.key ? { ...item, path: event.target.value } : item
                          )
                        )
                      }
                      className={cn(
                        'h-8 flex-1 border border-input font-mono text-xs',
                        conflict && 'text-destructive'
                      )}
                    />
                    {renderFolderPicker(row.path, (picked) =>
                      setIncoming((previous) =>
                        previous.map((item) =>
                          item.key === row.key ? { ...item, path: picked } : item
                        )
                      )
                    )}
                    {renderOpenInExplorer(row.path)}
                    {pathExists[row.path.trim()] === false ? (
                      // The folder was deleted from under us: there is nothing left to adopt, so
                      // say that instead of promising it will become a version. (`=== false`, not
                      // a falsy check — an un-probed path has no entry at all yet.)
                      <Badge variant="destructive" className="shrink-0 text-[10px]">
                        {t('versionConflict.versions.status.missing')}
                      </Badge>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('versionConflict.versions.incomingHint')}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

          {dropped.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
              <div className="text-xs text-muted-foreground">
                {t('versionConflict.versions.dropped', { folders: dropped.length })}
              </div>
              {dropped.map((row) => (
                <div key={row.conflictId} className={cn('flex items-center gap-2')}>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground line-through">
                    {row.path}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => {
                      setDropped((previous) =>
                        previous.filter((item) => item.conflictId !== row.conflictId)
                      )
                      const restored = detail?.incoming.find(
                        (entry) => entry.conflictId === row.conflictId
                      )
                      setIncoming((previous) => [
                        ...previous,
                        {
                          key: incomingKey(row.conflictId),
                          conflictId: row.conflictId,
                          name: incomingName(restored?.label),
                          path: restored?.path ?? row.path,
                          seedVersionId: restored?.targetVersionId ?? '',
                          kind: restored?.kind ?? 'path-exists'
                        }
                      ])
                    }}
                  >
                    {t('versionConflict.versions.restore')}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!isLoading && rows.length === 0 && dropped.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('versionConflict.versions.empty')}
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      <div className={cn('flex items-center gap-3')}>
        <div className={cn('flex flex-col gap-1 text-xs')}>
          {missingCount > 0 && (
            <span className="text-destructive">
              {t('versionConflict.versions.missingWarning', { folders: missingCount })}
            </span>
          )}
          {hasDirectoryClash && (
            <span className="text-destructive">
              {t('versionConflict.versions.duplicateWarning')}
            </span>
          )}
          {dropped.length > 0 && (
            <label className="flex cursor-pointer select-none items-center gap-2 text-muted-foreground">
              <Checkbox
                checked={ignoreFolder}
                onCheckedChange={(checked) => setIgnoreFolder(checked === true)}
              />
              {t('versionConflict.versions.ignoreDropped')}
            </label>
          )}
        </div>

        <div className={cn('ml-auto flex items-center gap-2')}>
          <Button variant="outline" onClick={onBack} disabled={isSaving}>
            {t('versionConflict.cancel')}
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              if ((detail?.mergeGameIds.length ?? 0) > 0) setConfirmOpen(true)
              else void handleSave()
            }}
          >
            {isSaving ? t('versionConflict.saving') : t('versionConflict.save')}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('versionConflict.mergeConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('versionConflict.mergeConfirm.description', {
                entries: detail?.mergeGameIds.length ?? 0,
                names: detail?.mergeTitles.join('、') ?? ''
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('utils:common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSave()}>
              {t('versionConflict.save')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
