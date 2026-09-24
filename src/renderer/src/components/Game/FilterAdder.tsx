import { cn } from '~/utils'
import { useFilterStore } from '~/components/Librarybar/Filter/store'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

export function FilterAdder({
  field,
  value,
  label,
  className
}: {
  field: string
  value: string
  /**
   * 显示文本。标签字段存的是实体 key（形如 `@vndb:lesbian sex`），必须由调用方
   * 传入当前语言的译名；不传则直接显示 value。筛选比较始终用 value。
   */
  label?: string
  className?: string
}): React.JSX.Element {
  const { filter, addFilter, updateFilter } = useFilterStore()
  const { t } = useTranslation('game')
  const text = label ?? value
  return (
    <button
      className={cn(
        'py-[1px] px-[4px] bg-accent/50 cursor-pointer rounded-lg text-xs text-accent-foreground hover:text-accent-foreground hover:bg-accent',
        className
      )}
      onClick={() => {
        if (field === 'metadata.releaseDate') {
          updateFilter(field, [value, value])
        } else {
          if (!filter[field]?.includes(value)) {
            addFilter(field, value)
          }
        }
        toast.info(t('detail.filter.added', { field: field, value: text }))
      }}
    >
      {text}
    </button>
  )
}
