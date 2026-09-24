import { Check, ChevronDownIcon, PlusIcon } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '~/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { selectTriggerClassName } from '~/components/ui/select'
import { useGameCollectionStore } from '~/stores'
import { cn } from '~/utils'

/** The "no collection" choice the scanner stores in `targetCollection`. */
export const NO_COLLECTION_ID = 'none'

interface CollectionComboboxProps {
  value: string
  onValueChange: (value: string) => void
  className?: string
  id?: string
}

type Row =
  | { kind: 'none' }
  | { kind: 'create'; name: string }
  | { kind: 'existing'; id: string; name: string }

/**
 * Collection picker that doubles as a creator: typing a name that no collection has yet offers
 * a "create" row, so a scan target can be made on the spot instead of detouring through the
 * library to create an empty collection first.
 *
 * Rendered as a Popover (not a `Select`) because the options depend on what is being typed.
 * `modal={false}` is deliberate: a modal layer would swallow the trigger's own click and the
 * dropdown could never be closed by clicking it again.
 */
export function CollectionCombobox({
  value,
  onValueChange,
  className,
  id
}: CollectionComboboxProps): React.JSX.Element {
  const { t } = useTranslation('scanner')
  const documents = useGameCollectionStore((state) => state.documents)
  const addCollection = useGameCollectionStore((state) => state.addCollection)

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const collections = React.useMemo(
    () =>
      Object.values(documents)
        .sort((a, b) => a.sort - b.sort)
        .map((collection) => ({ id: collection._id, name: collection.name ?? '' })),
    [documents]
  )

  /** A collection can be created without a name, so never render an empty row. */
  const displayName = (name: string): string => name || t('editScanner.targetCollectionUnnamed')

  const selected = collections.find((collection) => collection.id === value) ?? null

  const trimmedQuery = query.trim()
  const lowerQuery = trimmedQuery.toLowerCase()
  const matchingCollections = React.useMemo(
    () => collections.filter((collection) => collection.name.toLowerCase().includes(lowerQuery)),
    [collections, lowerQuery]
  )

  /** Only a name no collection carries yet is worth offering to create. */
  const creatableName =
    trimmedQuery.length > 0 &&
    !collections.some((collection) => collection.name.toLowerCase() === lowerQuery)
      ? trimmedQuery
      : null

  /**
   * Rows in display order. `canCreate` puts the create row first so it is both the most visible
   * action and what Enter triggers — the list is short enough that "first row" is unambiguous.
   */
  const rows: Row[] = [
    ...(creatableName ? ([{ kind: 'create', name: creatableName }] as Row[]) : []),
    { kind: 'none' },
    ...matchingCollections.map((collection) => ({
      kind: 'existing' as const,
      id: collection.id,
      name: collection.name
    }))
  ]

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }

  const handleValueChange = (nextValue: string): void => {
    onValueChange(nextValue)
    close()
  }

  const handleCreate = async (name: string): Promise<void> => {
    // Created right away rather than on save, so the new collection can be shown as selected
    // straight away and reused if the user keeps editing the scanner.
    const newId = await addCollection(name)
    onValueChange(newId)
    close()
  }

  const activateRow = (row: Row): void => {
    if (row.kind === 'none') handleValueChange(NO_COLLECTION_ID)
    else if (row.kind === 'existing') handleValueChange(row.id)
    else void handleCreate(row.name)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // A leftover search would otherwise silently narrow the next time it opens.
        if (!next) setQuery('')
      }}
      modal={false}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          data-size="default"
          // `selectTriggerClassName` carries `w-fit`; `!w-full` makes the width authoritative, and
          // `min-w-0` is what keeps a long collection name from widening the dialog's grid column
          // (a grid item's default `min-width: auto` would let the nowrap text push the track out).
          className={cn(selectTriggerClassName, '!w-full min-w-0 text-sm', className)}
        >
          <span
            className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}
            title={selected ? displayName(selected.name) : undefined}
          >
            {selected ? displayName(selected.name) : t('editScanner.targetCollectionNone')}
          </span>
          <ChevronDownIcon className={cn('size-4 opacity-50')} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-[var(--radix-popover-trigger-width)] min-w-0 p-0')}
      >
        <Command shouldFilter={false} className={cn('max-w-none')}>
          <CommandInput
            className={cn('non-draggable')}
            value={query}
            onValueChange={setQuery}
            placeholder={t('editScanner.targetCollectionSearch')}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || rows.length === 0) return
              // Take over Enter: it must pick the first row, which is what the user sees.
              event.preventDefault()
              activateRow(rows[0])
            }}
          />
          <CommandList className={cn('scrollbar-base')}>
            <CommandGroup>
              {rows.map((row) => {
                const key =
                  row.kind === 'none'
                    ? NO_COLLECTION_ID
                    : row.kind === 'existing'
                      ? row.id
                      : '__create__'

                if (row.kind === 'create') {
                  return (
                    <CommandItem
                      key={key}
                      value={key}
                      onSelect={() => activateRow(row)}
                      className={cn('data-[selected=true]:bg-accent')}
                    >
                      <PlusIcon className={cn('size-4')} />
                      {t('editScanner.targetCollectionCreate', { name: row.name })}
                    </CommandItem>
                  )
                }

                const isSelected = row.kind === 'none' ? !selected : selected?.id === row.id
                return (
                  <CommandItem key={key} value={key} onSelect={() => activateRow(row)}>
                    <span className={cn('truncate')}>
                      {row.kind === 'none'
                        ? t('editScanner.targetCollectionNone')
                        : displayName(row.name)}
                    </span>
                    <Check
                      className={cn('ml-auto size-4', isSelected ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                )
              })}

              {/* `CommandEmpty` cannot be used here: filtering is ours, cmdk sees every row as a hit. */}
              {matchingCollections.length === 0 && !creatableName && (
                <div className={cn('py-6 text-center text-sm text-muted-foreground')}>
                  {t('editScanner.targetCollectionEmpty')}
                </div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
