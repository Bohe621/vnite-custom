import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import { Dialog, DialogContent } from '~/components/ui/dialog'
import { cn } from '~/utils'
import { useGameState, useTagDisplay } from '~/hooks'
import { ArrayInput } from '~/components/ui/array-input'
import { ipcManager } from '~/app/ipc'

export function TagsDialog({
  gameId,
  isOpen,
  setIsOpen
}: {
  gameId: string
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [tags, , , setTagsAndSave] = useGameState(gameId, 'metadata.tags', true)
  const tagDisplay = useTagDisplay(tags)

  /** 编辑期间用户实际敲进去的文本；为 null 表示还没动过手，直接显示词库映射出的译名 */
  const [draft, setDraft] = useState<string[] | null>(null)
  const shownTags = useMemo(
    () => draft ?? tags.map((tag) => tagDisplay[tag] ?? tag),
    [draft, tags, tagDisplay]
  )

  /**
   * 输入框里看到并编辑的是译名，落库前必须还原成实体 key：认得出的复用已有实体，
   * 认不出的按当前界面语言铸成用户标签。否则同一概念会以「译名」和「key」两种形态
   * 并存，筛选时互相看不见。
   */
  const handleBlur = async (): Promise<void> => {
    const pending = draft
    if (!pending) return

    let keys = pending
    try {
      keys = await ipcManager.invoke('tag-lexicon:ensure-many', {
        values: pending,
        provider: 'user'
      })
    } catch (error) {
      console.error('[TagsDialog] Failed to normalize tags, saving raw values:', error)
    }

    await setTagsAndSave(keys)
    setDraft(null)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className={cn('w-[500px] h-[300px] max-w-none flex flex-col gap-5')}>
        <div className={cn('text-xs -mb-2')}>{t('detail.overview.tags.separator')}</div>
        <ArrayInput
          className={cn('grow resize-none')}
          value={shownTags}
          onChange={setDraft}
          onBlur={handleBlur}
          placeholder={t('detail.overview.tags.empty')}
          isTextarea
          isHaveTooltip={false}
        />
      </DialogContent>
    </Dialog>
  )
}
