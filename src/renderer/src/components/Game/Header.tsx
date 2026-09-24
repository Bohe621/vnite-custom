import { NSFWBlurLevel } from '@appTypes/models'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '~/components/ui/context-menu'
import { useConfigState, useGameState, useGameVersions } from '~/hooks'
import { useRunningGames } from '~/pages/Library/store'
import { cn, copyWithToast } from '~/utils'
import { GameImage } from '../ui/game-image'
import { Config } from './Config'
import { GameDirectory } from './GameDirectory'
import { Record } from './Overview/Record'
import { StartGame } from './StartGame'
import { StopGame } from './StopGame'
import { useGameDetailStore } from './store'
import { openLargeGameMediaImage } from './utils'
import { VersionSelecter } from './VersionSelecter'

export function Header({
  gameId,
  className
}: {
  gameId: string
  className?: string
}): React.JSX.Element {
  const runningGames = useRunningGames((state) => state.runningGames)
  const [name] = useGameState(gameId, 'metadata.name')
  const { currentVersionId, setCurrentVersion } = useGameVersions(gameId)
  const [originalName] = useGameState(gameId, 'metadata.originalName')
  const [showOriginalNameInGameHeader] = useConfigState('game.gameHeader.showOriginalName')
  const [showCover] = useConfigState('appearances.gameDetail.showCover')
  const [nsfw] = useGameState(gameId, 'apperance.nsfw')
  const [nsfwBlurLevel] = useConfigState('appearances.nsfwBlurLevel')
  const openPropertiesDialog = useGameDetailStore((state) => state.openPropertiesDialog)
  const openImageViewer = useGameDetailStore((state) => state.openImageViewer)

  const stringToBase64 = (str: string): string =>
    btoa(String.fromCharCode(...new TextEncoder().encode(str)))
  const obfuscatedName = stringToBase64(name).slice(0, name.length)

  const { t } = useTranslation('game')

  return (
    <div className={cn('flex-col flex gap-5 px-7 py-5 pl-6 pt-6 relative', className)}>
      {/* Game name section */}
      <div className="flex flex-row justify-between items-end">
        <div
          className={cn('flex flex-col gap-3 grow overflow-hidden items-start justify-start pl-1')}
        >
          <div
            className={cn(
              'font-bold text-2xl text-accent-foreground cursor-pointer select-none text-shadow-lg break-all group'
            )}
            onClick={() => copyWithToast(name)}
          >
            {nsfw && nsfwBlurLevel >= NSFWBlurLevel.BlurImageAndTitle ? (
              <>
                <span className="block group-hover:hidden">{obfuscatedName}</span>
                <span className="hidden group-hover:block">{name}</span>
              </>
            ) : (
              name
            )}
          </div>
          {showOriginalNameInGameHeader && originalName && (
            <div
              className={cn(
                'font-bold text-accent-foreground cursor-pointer select-none break-all group'
              )}
              onClick={() => copyWithToast(originalName)}
            >
              {nsfw && nsfwBlurLevel >= NSFWBlurLevel.BlurImageAndTitle ? (
                <>
                  <span className="block group-hover:hidden">{obfuscatedName}</span>
                  <span className="hidden group-hover:block">{originalName}</span>
                </>
              ) : (
                originalName
              )}
            </div>
          )}
          <div
            className={cn(
              'flex flex-row justify-between items-end duration-300 select-none mt-2 pb-1',
              '3xl:gap-5'
            )}
          >
            <div className={cn('flex flex-row gap-3 items-end z-20', '3xl:gap-5')}>
              {/* Start/Stop game button */}
              {runningGames.includes(gameId) ? (
                <StopGame gameId={gameId} className={cn('w-[170px] h-[40px]')} />
              ) : (
                <StartGame gameId={gameId} className={cn('w-[170px] h-[40px]')} />
              )}

              {/* Configuration button */}
              <Config gameId={gameId} />

              {/* Launch version — decides the launcher and launch mode used by StartGame */}
              <div className={cn('flex h-[40px] items-center')}>
                <VersionSelecter
                  gameId={gameId}
                  scope="launch"
                  value={currentVersionId}
                  onChange={(versionId) => void setCurrentVersion(versionId)}
                  className={cn('max-w-[240px]')}
                />
              </div>
            </div>
          </div>
        </div>
        {/* Game cover image with context menu */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="relative lg:mr-3 pb-1 shrink-0">
              {showCover && (
                <GameImage
                  gameId={gameId}
                  key={`${gameId}-poster`}
                  type="cover"
                  blur={nsfw && nsfwBlurLevel >= NSFWBlurLevel.BlurImage}
                  className={cn('w-auto h-[170px] object-cover rounded-lg shadow-md')}
                  fallback={<div className="h-[170px]" />}
                  onClick={() => {
                    void openLargeGameMediaImage({
                      gameId,
                      type: 'cover',
                      openImageViewer
                    })
                  }}
                />
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className={cn('w-40')}>
            <ContextMenuItem onSelect={() => openPropertiesDialog('media')}>
              {t('detail.contextMenu.editMediaProperties')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      {/* Game folder — its own line, sitting inside the gap the name row and the record row already
          had, not added on top of it. The two negative margins sum to
          20 (spacing to keep) - 2 × 20 (the two gap-5s) - 26 (this row's height) = -46px, which is
          what holds the distance between the name row's bottom and the record block's top at the
          20px it has always been. Split so the row's own top edge — and therefore its text, which
          carries the `pt-[5px]` — does not move: the extra height all goes downwards.
          If the row's height changes (it carries a `pt-[5px] pb-[5px]`), re-derive this.
          Capped at 750px so a deep path cannot stretch across the whole header. */}
      <GameDirectory gameId={gameId} className={cn('max-w-[750px] pl-1 -mt-[20px] -mb-[26px]')} />
      {/* Game record section */}
      <div className="pt-6">
        <Record gameId={gameId} />
      </div>
    </div>
  )
}
