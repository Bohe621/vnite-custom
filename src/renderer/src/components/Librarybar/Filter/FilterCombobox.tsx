import { DEFAULT_PLAY_STATUS_ORDER } from '@appTypes/models/game'
import { Cross2Icon } from '@radix-ui/react-icons'
import { Button } from '@ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@ui/popover'
import { Check, ChevronsUpDown } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useTagDisplay } from '~/hooks'
import { getAllExtraValuesForKey, getAllValuesInKey } from '~/stores/game'
import { cn } from '~/utils'
import { useFilterStore } from './store'

interface Option {
  value: string
  label: string
}

/** 稳定的空数组，避免 useTagDisplay 每次拿到新引用 */
const NO_VALUES: readonly string[] = []

export function FilterCombobox({
  field,
  placeholder
}: {
  field: string
  placeholder: string
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [open, setOpen] = React.useState(false)
  const { filter, deleteFilter, addFilter } = useFilterStore()
  const selectedValues = filter[field] || []

  const allValues: string[] = React.useMemo(() => {
    // Check if it's an extra information field
    if (field.startsWith('metadata.extra.')) {
      const extraKey = field.replace('metadata.extra.', '')
      const values = getAllExtraValuesForKey(extraKey)
      console.warn(`allValues: ${values} extraKey: ${extraKey}`)
      return values
    }
    return getAllValuesInKey(field as any)
  }, [field])

  // 标签字段的候选值是实体 key，下拉里要显示当前语言的译名（值本身仍用 key）
  const tagDisplay = useTagDisplay(field === 'metadata.tags' ? allValues : NO_VALUES)

  const options: Option[] = React.useMemo(() => {
    const allOptions = allValues.map((value) => ({
      value,
      label:
        field === 'record.playStatus'
          ? t(`utils:game.playStatus.${value}`) // Translate play status
          : field === 'metadata.tags'
            ? (tagDisplay[value] ?? value)
            : value
    }))

    // Sort: selected items appear first
    return allOptions.sort((a, b) => {
      const aSelected = selectedValues.includes(a.value)
      const bSelected = selectedValues.includes(b.value)

      if (aSelected && !bSelected) return -1
      if (!aSelected && bSelected) return 1
      if (field === 'record.playStatus') {
        // Sort play status by predefined order
        const orderIndexA = DEFAULT_PLAY_STATUS_ORDER.indexOf(a.value as any)
        const orderIndexB = DEFAULT_PLAY_STATUS_ORDER.indexOf(b.value as any)
        return orderIndexA - orderIndexB
      }
      return a.label.localeCompare(b.label, 'zh-CN')
    })
  }, [allValues, selectedValues, t, field, tagDisplay])

  const handleSelect = (value: string): void => {
    if (selectedValues.includes(value)) {
      // If already selected, remove it
      deleteFilter(field, value)
    } else {
      // If not selected, add it
      addFilter(field, value)
    }
  }

  return (
    <div className={cn('flex flex-row gap-2')}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="justify-between non-draggable"
          >
            {/* Display selected values */}
            <div className="flex flex-row gap-1 -ml-2 mx-1 my-1 p-0 pl-1 truncate w-[196px]">
              {selectedValues.length > 0 ? (
                selectedValues.map((value) => (
                  <span
                    key={value}
                    className="px-2 py-1 text-sm rounded-md bg-primary/[0.8] text-primary-foreground"
                  >
                    {options.find((opt) => opt.value === value)?.label ||
                      tagDisplay[value] ||
                      value}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">
                  {t('filter.combobox.select', { placeholder })}
                </span>
              )}
            </div>
            <ChevronsUpDown className="w-4 h-4 ml-2 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          className="w-[240px] p-0 max-w-none bg-transparent"
        >
          <Command className={cn('max-w-none')}>
            {/* Search Input */}
            <CommandInput
              placeholder={t('filter.combobox.search', { placeholder })}
              className={cn('non-draggable')}
            />
            <CommandEmpty>{t('filter.combobox.notFound', { placeholder })}</CommandEmpty>
            <CommandList className={cn('scrollbar-base')}>
              <CommandGroup>
                {/* Display all values */}
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    // 搜索匹配显示文本；实体 key 作为附加关键词，两种写法都能搜到
                    value={option.label}
                    keywords={option.label === option.value ? undefined : [option.value]}
                    onSelect={() => handleSelect(option.value)}
                  >
                    {option.label}
                    <Check
                      className={cn(
                        'ml-auto',
                        selectedValues.includes(option.value) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button
        size={'icon'}
        variant={'outline'}
        onClick={() => {
          deleteFilter(field, '#all')
        }}
      >
        <Cross2Icon className="w-4 h-4" />
      </Button>
    </div>
  )
}
