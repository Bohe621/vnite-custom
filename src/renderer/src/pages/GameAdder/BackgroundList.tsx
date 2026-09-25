import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import { Button } from '~/components/ui/button'
import { UpscaleConfigControl } from '~/components/utils/UpscaleConfigControl'
import { cn } from '~/utils'
import { useGameMetadataUpdaterStore } from '../GameMetadataUpdater/store'
import { useGameAdderStore } from './store'

/** 一页 8 张（2 列 × 4 行）—— 候选是**多个源**汇总来的，很容易超过这个数。 */
const PAGE_SIZE = 8

export function BackgroundList(): React.JSX.Element {
  const { t } = useTranslation(['adder', 'game'])
  const {
    backgroundUrl,
    setBackgroundUrl,
    backgroundList,
    setBackgroundList,
    dataSourceId,
    dataSource,
    name,
    dbId,
    dirPath,
    gamePath,
    enableUpscale,
    setEnableUpscale,
    handleClose
  } = useGameAdderStore()

  const {
    setIsOpen: setIsGameMetadataUpdaterDialogOpen,
    setBackgroundUrl: setGameMetadataUpdaterBackgroundUrl,
    setDataSource: setGameMetadataUpdaterDataSource,
    setDataSourceId: setGameMetadataUpdaterDataSourceId,
    setGameIds: setGameMetadataUpdaterGameIds,
    setEnableUpscale: setGameMetadataUpdaterEnableUpscale
  } = useGameMetadataUpdaterStore()

  const [isAdding, setIsAdding] = useState(false)
  const [page, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(backgroundList.length / PAGE_SIZE))
  const pageItems = backgroundList.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  useEffect(() => {
    const fetchBackgrounds = async (): Promise<void> => {
      try {
        toast.loading(t('gameAdder.backgrounds.notifications.loading'), {
          id: 'loading-backgrounds'
        })
        // 汇总所有能出背景图的源：当前源按精确 id 查，其余只能按游戏名搜
        // （见 ScraperManager.getAllGameBackgrounds）。
        const result = await ipcManager.invoke(
          'scraper:get-all-game-backgrounds',
          dataSource,
          { type: 'id', value: dataSourceId },
          name
        )
        if (result.length === 0) {
          toast.error(t('gameAdder.backgrounds.notifications.noImages'), {
            id: 'loading-backgrounds'
          })
          setBackgroundUrl('')
          return
        }
        setBackgroundUrl(result[0].url)
        setBackgroundList(result)
        setPage(0)
        toast.success(t('gameAdder.backgrounds.notifications.success'), {
          id: 'loading-backgrounds'
        })
      } catch (error) {
        toast.error(t('gameAdder.backgrounds.notifications.error', { message: String(error) }), {
          id: 'loading-backgrounds'
        })
      }
    }
    fetchBackgrounds()
  }, [])

  // 选中项所在元素在翻页后才存在，所以滚动不能只在按键时做 —— 放在这里，换页/换图都会补齐。
  useEffect(() => {
    if (!backgroundUrl) return
    const target = document.querySelector(`[data-image="${CSS.escape(backgroundUrl)}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }, [backgroundUrl, page])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const index = backgroundList.findIndex((candidate) => candidate.url === backgroundUrl)
      if (index === -1) return

      if (e.key === 'Enter') {
        addGameToDB()
        return
      }

      let targetIndex: number | null = null
      if (e.key === 'ArrowRight') targetIndex = index + 1
      else if (e.key === 'ArrowDown') targetIndex = index + 2
      else if (e.key === 'ArrowLeft') targetIndex = index - 1 + backgroundList.length
      else if (e.key === 'ArrowUp') targetIndex = index - 2 + backgroundList.length

      if (targetIndex !== null) {
        targetIndex %= backgroundList.length
        setBackgroundUrl(backgroundList[targetIndex].url)
        // 选中项落到别的页就跟着翻过去，否则方向键会在看不见的地方"空走"。
        setPage(Math.floor(targetIndex / PAGE_SIZE))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return (): void => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [backgroundUrl, backgroundList])

  async function addGameToDB(): Promise<void> {
    if (isAdding) return
    setIsAdding(true)
    try {
      if (dbId) {
        // Updater Mode
        setGameMetadataUpdaterBackgroundUrl(backgroundUrl)
        setGameMetadataUpdaterDataSource(dataSource)
        setGameMetadataUpdaterGameIds([dbId])
        setIsGameMetadataUpdaterDialogOpen(true)
        setIsAdding(false)
        setGameMetadataUpdaterDataSourceId(dataSourceId)
        setGameMetadataUpdaterEnableUpscale(enableUpscale)
        handleClose()
        return
      } else {
        toast.loading(t('gameAdder.backgrounds.notifications.adding'), {
          id: 'adding-game'
        })
        await ipcManager.invoke('adder:add-game-to-db', {
          dataSource,
          dataSourceId,
          backgroundUrl,
          upscaleEnabled: enableUpscale,
          dirPath,
          gamePath
        })
        setIsAdding(false)
        handleClose()
        toast.success(t('gameAdder.backgrounds.notifications.addSuccess'), {
          id: 'adding-game'
        })
        return
      }
    } catch (error) {
      setIsAdding(false)
      toast.error(t('gameAdder.backgrounds.notifications.addError', { message: String(error) }), {
        id: 'adding-game'
      })
    }
  }

  return (
    <div className={cn('w-[50vw] h-[80vh] p-3')}>
      <div className={cn('flex flex-col w-full h-full gap-3')}>
        <div className={cn('font-bold')}>{t('gameAdder.backgrounds.title')}</div>
        {/* flex-1 + min-h-0 才能让滚动区吃掉剩余高度；只用 h-full 的话网格会把下面的
            分页控件和「确定」按钮一起顶出视口。 */}
        <div className={cn('scrollbar-base overflow-auto flex-1 min-h-0 pr-3')}>
          <div className={cn('grid grid-cols-2 gap-3')}>
            {pageItems.length !== 0 ? (
              pageItems.map((candidate) => (
                <div
                  key={candidate.url}
                  data-image={candidate.url}
                  onClick={() => {
                    setBackgroundUrl(candidate.url)
                  }}
                  className={cn(
                    'relative cursor-pointer p-3 bg-muted text-muted-foreground rounded-lg',
                    candidate.url === backgroundUrl
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {/* 来源标记：非当前源是按游戏名搜来的，可能匹配到别的游戏，必须让用户看得见。 */}
                  <span
                    className={cn(
                      'absolute top-2 right-2 rounded bg-black/65 px-2 py-0.5 text-xs text-white'
                    )}
                  >
                    {candidate.sourceName}
                  </span>
                  <img src={candidate.url} alt={candidate.sourceName} className="w-full h-auto" />
                </div>
              ))
            ) : (
              <div>{t('gameAdder.backgrounds.noImages')}</div>
            )}
          </div>
        </div>
        {pageCount > 1 && (
          <div className={cn('flex items-center justify-center gap-3')}>
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            >
              {t('gameAdder.backgrounds.previousPage')}
            </Button>
            <span className={cn('text-sm text-muted-foreground')}>
              {t('gameAdder.backgrounds.pageIndicator', { current: page + 1, total: pageCount })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((prev) => Math.min(pageCount - 1, prev + 1))}
            >
              {t('gameAdder.backgrounds.nextPage')}
            </Button>
          </div>
        )}
        <div className={cn('flex flex-row-reverse items-center gap-3')}>
          <Button onClick={addGameToDB}>{t('utils:common.confirm')}</Button>
          {!dbId && (
            <UpscaleConfigControl
              checked={enableUpscale}
              onCheckedChange={setEnableUpscale}
              label={t('game:detail.properties.media.actions.upscaleImage')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
