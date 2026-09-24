import { SeparatorDashed } from '@ui/separator-dashed'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameState, useTagDisplay } from '~/hooks'
import { cn, copyWithToast } from '~/utils'
import { FilterAdder } from '../../FilterAdder'
import { SearchTagsDialog } from './SearchTagsDialog'
import { TagsDialog } from './TagsDialog'
import { ipcManager } from '~/app/ipc'

export function TagsCard({
  gameId,
  className = ''
}: {
  gameId: string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [tags, setTags] = useGameState(gameId, 'metadata.tags')
  const [originalName] = useGameState(gameId, 'metadata.originalName')
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  // 数据库里存的是标签实体 key，界面上显示当前语言的译名（认不出来的原样显示）
  const tagDisplay = useTagDisplay(tags)

  const handleSelectTags = async (newTags: string[]): Promise<void> => {
    // 对话框的初值取自库里现有的 `metadata.tags`，里面可能还留着词库上线前的旧原文；
    // 用户原样确认就会把它们再写回去。所以写库前统一过一次词库：认得出的转成实体 key、
    // 认不出的铸造成 `@user:<原文>` —— 落库的**永远是 key**（`@dlsite:genre:288` 这种）。
    const keys = await ipcManager.invoke('tag-lexicon:ensure-many', {
      values: newTags,
      provider: 'user'
    })
    setTags(keys)
  }

  return (
    <div className={cn(className, 'group')}>
      <div className={cn('flex flex-row justify-between items-center')}>
        <div
          className={cn('font-bold select-none cursor-pointer')}
          onClick={() => copyWithToast(tags.map((tag) => tagDisplay[tag] ?? tag).join(', '))}
        >
          {t('detail.overview.sections.tags')}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'invisible group-hover:visible hover:text-primary cursor-pointer icon-[mdi--magnify] w-5 h-5'
            )}
            onClick={() => setIsSearchDialogOpen(true)}
          ></span>
          <span
            className={cn(
              'invisible group-hover:visible hover:text-primary cursor-pointer icon-[mdi--square-edit-outline] w-5 h-5'
            )}
            onClick={() => setIsEditDialogOpen(true)}
          ></span>
        </div>
      </div>
      <SeparatorDashed />
      <div className={cn('text-sm justify-start items-start')}>
        <div className={cn('flex flex-wrap gap-x-1 gap-y-[6px]')}>
          {tags.join(', ') === ''
            ? t('detail.overview.tags.empty')
            : tags.map((tag) => (
                <React.Fragment key={tag}>
                  <FilterAdder
                    field="metadata.tags"
                    value={tag}
                    label={tagDisplay[tag] ?? tag}
                    className={cn('')}
                  />
                </React.Fragment>
              ))}
        </div>
      </div>

      <TagsDialog gameId={gameId} isOpen={isEditDialogOpen} setIsOpen={setIsEditDialogOpen} />

      <SearchTagsDialog
        isOpen={isSearchDialogOpen}
        onClose={() => setIsSearchDialogOpen(false)}
        gameTitle={originalName}
        onSelect={handleSelectTags}
        initialTags={tags}
      />
    </div>
  )
}
