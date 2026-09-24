import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useTagConflictStore } from '~/stores/tagConflictStore'
import { useVersionConflictStore } from '~/stores/versionConflictStore'
import { cn } from '~/utils'
import { TagConflictPanel } from './TagConflictPanel'
import { VersionCard } from './VersionCard'
import { VersionReviewPanel } from './VersionReviewPanel'

/**
 * 冲突管理：把「扫描/入库之后需要人拍板的事」收到一处。两个页签、两种完全不同的来源：
 *
 * - **游戏版本**：库里有共享同一条目 ID 的重复记录、或扫描到的文件夹无法自动判定归属
 *   （`versionReview.ts`）。选中一个游戏即可编辑它的全部版本。
 * - **标签**：入库不再按文本自动归并之后浮出来的两种情形 —— 两个概念撞同一个词、或抓取到的
 *   写法与该语言已有的译名不一致（来龙去脉写在 `TagConflictPanel` 的注释里）。
 *
 * 页签切换是手写的两个按钮 + CSS 显隐，没有用 Radix `Tabs`：概览里的海报在**挂载时**会跑
 * 一遍 smart-crop，卸载再回来整屏封面会跳（版本面板里原本就为此写成 hidden 而不是卸载），
 * 所以两边都得保持挂载。
 *
 * 从侧栏挂载一次（角标也在那儿），设置页通过 store 打开，两边共用同一个实例与同一份列表。
 */
type ConflictTab = 'version' | 'tag'

export function ConflictCenterDialog(): React.JSX.Element {
  const { t } = useTranslation('adder')
  const reviews = useVersionConflictStore((state) => state.reviews)
  const isOpen = useVersionConflictStore((state) => state.isDialogOpen)
  const setDialogOpen = useVersionConflictStore((state) => state.setDialogOpen)
  const selectedGameId = useVersionConflictStore((state) => state.selectedGameId)
  const selectGame = useVersionConflictStore((state) => state.selectGame)
  const refresh = useVersionConflictStore((state) => state.refresh)
  const tagConflicts = useTagConflictStore((state) => state.conflicts)

  const [tab, setTab] = useState<ConflictTab>('version')

  // Refetch on open: a scan or another window may have changed the list since it was loaded.
  useEffect(() => {
    if (isOpen) void refresh()
  }, [isOpen, refresh])

  const tagPendingCount = tagConflicts.filter((item) => item.status === 'pending').length

  return (
    <Dialog open={isOpen} onOpenChange={setDialogOpen}>
      <DialogContent className={cn('w-[80vw] max-w-[1100px]')}>
        <div className={cn('flex h-[78vh] min-h-0 flex-col gap-3')}>
          <DialogHeader>
            <DialogTitle>{t('conflictCenter.title')}</DialogTitle>
            <DialogDescription>{t('conflictCenter.description')}</DialogDescription>
          </DialogHeader>

          <div className={cn('flex items-center gap-1')}>
            <Button
              size="sm"
              variant={tab === 'version' ? 'secondary' : 'ghost'}
              onClick={() => setTab('version')}
            >
              {t('conflictCenter.tabs.version')}
              {reviews.length > 0 && (
                <span className={cn('ml-1 text-xs text-destructive')}>{reviews.length}</span>
              )}
            </Button>
            <Button
              size="sm"
              variant={tab === 'tag' ? 'secondary' : 'ghost'}
              onClick={() => setTab('tag')}
            >
              {t('conflictCenter.tabs.tag')}
              {tagPendingCount > 0 && (
                <span className={cn('ml-1 text-xs text-destructive')}>{tagPendingCount}</span>
              )}
            </Button>
          </div>

          <div className={cn('min-h-0 flex-1')}>
            <div className={cn('h-full min-h-0', tab !== 'version' && 'hidden')}>
              {/*
                The overview stays mounted while the editor is up, only hidden. Swapping it out for
                the editor unmounts every poster, and each `GameImage` re-runs its smart-crop pass on
                mount — so coming back made all the covers jump. Keeping the DOM alive also preserves
                the grid's scroll position.
              */}
              <ScrollArea className={cn('h-full', selectedGameId && 'hidden')}>
                {reviews.length === 0 ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    {t('versionConflict.empty')}
                  </div>
                ) : (
                  <div className={cn('flex flex-wrap gap-6 pr-3 pb-2')}>
                    {reviews.map((review) => (
                      <VersionCard key={review.gameId} review={review} onSelect={selectGame} />
                    ))}
                  </div>
                )}
              </ScrollArea>

              {selectedGameId && (
                <VersionReviewPanel
                  key={selectedGameId}
                  gameId={selectedGameId}
                  onBack={() => selectGame(null)}
                />
              )}
            </div>

            <div className={cn('h-full min-h-0', tab !== 'tag' && 'hidden')}>
              <TagConflictPanel />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
