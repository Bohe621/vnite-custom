import type { TagLexiconEntity } from '@appTypes/models'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { cn } from '~/utils'
import { clueSummary } from './clues'
import { EntityPicker } from './EntityPicker'

/** 「修改为」在单选框里占的值（候选都是真名字，不会撞上） */
const CUSTOM = '__custom__'

/** 一个写法由谁提供：`'target'` = 目标，数字 = 第几条源（从 1 起，按传进来的顺序） */
type Owner = 'target' | number

/**
 * 预览行：某个语言下的候选写法，以及**默认会留下**哪一个。
 *
 * `spellings[0]` 就是主进程 `unionNames` 的语义结果（目标的写法赢；目标没有时第一条源的留下），
 * 所以「不作任何选择」= 用 `spellings[0]`。
 */
type PreviewRow = {
  lang: string
  spellings: string[]
  owners: Owner[][]
  /** 目标在这个语言有没有写法 —— 没有就是「目标缺，本条补上」 */
  targetHas: boolean
  /** 候选 ≥ 2 才需要用户决定 */
  needsChoice: boolean
}

/**
 * 合并标签（`tag-lexicon:merge`）：译名与全部来源索引并入目标，源自己的 key 写一条重定向。
 *
 * 与「修正索引」（`move-source`）的分工：合并是**整条**实体没了（原 key 以后靠 redirect 解析），
 * 修正索引只动线索、两条实体都还在。判断标准是「这条是不是压根不该存在」。
 *
 * `fromKeys` 支持**多条**（列表里 Ctrl 多选合并）：此时目标在选中集合里挑，
 * 其余全部并进它（逐条调 `merge`，`namesOverride` 每次传同一份，最后一遍落定写法）。
 *
 * ⚠️ 译名是**按语言**合并的（一个语言只能有一个显示名），两边同语言都有写法时必然丢一个。
 * 默认丢源的（`unionNames` 的语义），但**这里让用户逐语言选**（2026-09-24 用户要求
 * 「同语言都有译名且冲突时要让我可视化确认」），选出来的结果通过 `namesOverride` 直接传给主进程。
 */
export function MergeDialog({
  open,
  onOpenChange,
  fromKeys,
  fromLabel,
  presetTarget,
  onDone
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 要被并掉的（源）实体；多条 = 多选合并 */
  fromKeys: string[]
  /** 源实体的显示名，用在标题上；多选时省略（标题走 `titleMulti`） */
  fromLabel?: string
  /**
   * 预选目标。冲突面板从 `duplicate` 冲突进来时就是对面那条、多选合并时是**最后点选的那条**
   * （用户仍可改）—— 那条路径以前是一键直并（`resolveConflict(id,'accept')` → `merge(key, other)`），
   * 于是**没有译名选择**，和「并到其它实体…」行为不一致（2026-09-24 用户指出）。
   */
  presetTarget?: string | null
  onDone?: () => void
}): React.JSX.Element {
  const { t } = useTranslation('tagLexicon')
  /**
   * 依赖用竖线拼出来的串而不是数组本身：调用方多半写 `fromKeys={[key]}`，
   * 每次渲染都是新数组，直接进依赖会让「取实体」的 effect 无限重跑。
   * （`@tag:xxx` 里不可能出现 `|`。）
   */
  const keysToken = fromKeys.join('|')
  const keys = useMemo(() => (keysToken ? keysToken.split('|') : []), [keysToken])
  /** 多条源时目标只能在选中集合里挑（自选目标那条路径是行菜单的单条合并） */
  const isBulk = keys.length > 1

  // 调用方都是条件渲染（打开才挂载），所以用初始化值即可，不必再同步一次
  const [target, setTarget] = useState<string | null>(presetTarget ?? null)
  const [isSaving, setIsSaving] = useState(false)
  /** 涉及到的实体（源 + 目标）—— 预览与「目标候选」都从这里取 */
  const [loaded, setLoaded] = useState<Record<string, TagLexiconEntity>>({})
  /**
   * 每个语言选的写法。缺失 = 用默认的（`spellings[0]`）；值 = 那个候选写法本身；
   * `CUSTOM` = 用 `customNames[lang]` 里用户敲的值。
   */
  const [nameChoice, setNameChoice] = useState<Record<string, string>>({})
  const [customNames, setCustomNames] = useState<Record<string, string>>({})

  // 多选进来却没给目标（调用方理论上都会给）也要有个基准，否则预览算不出来
  useEffect(() => {
    if (isBulk && !target) setTarget(keys[keys.length - 1])
  }, [isBulk, target, keys])

  // 换了目标实体，之前的选择就没有意义了
  useEffect(() => {
    setNameChoice({})
    setCustomNames({})
  }, [target])

  // 源实体 + 目标的完整数据（含内置名与抓取积累的 fetchedNames），预览要的就是「合并后会变成什么」
  useEffect(() => {
    if (!open || !keysToken) {
      setLoaded({})
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const wanted = [...new Set([...keysToken.split('|'), target].filter(Boolean))] as string[]
        const list = await ipcManager.invoke('tag-lexicon:get-entities', { keys: wanted })
        if (cancelled) return
        setLoaded(Object.fromEntries(list.map((entity) => [entity.key, entity])))
      } catch (error) {
        console.error('[TagLexicon] Failed to load the merge preview:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, keysToken, target])

  /** 除目标以外的那些（真正会被并掉的） */
  const sources = useMemo(
    () =>
      keys
        .filter((key) => key !== target)
        .map((key) => loaded[key])
        .filter(Boolean) as TagLexiconEntity[],
    [keys, loaded, target]
  )
  const targetEntity = target ? (loaded[target] ?? null) : null
  /** 多选时出现在「合并到」那一排的候选（= 选中的全部） */
  const candidates = useMemo(
    () => keys.map((key) => loaded[key]).filter(Boolean) as TagLexiconEntity[],
    [keys, loaded]
  )

  const ownerText = (owner: Owner): string =>
    owner === 'target'
      ? t('merge.preview.ownerTarget')
      : sources.length === 1
        ? t('merge.preview.ownerSource')
        : t('merge.preview.ownerSourceN', { index: owner })

  /**
   * 每个语言的候选写法。
   *
   * 只列「有源实体写过的语言」—— 目标独有的译名不会因合并而变，列出来是噪音。
   * 目标的写法排最前，与主进程的默认语义（目标赢）对齐。
   */
  const preview: PreviewRow[] = useMemo(() => {
    const targetNames = targetEntity?.names ?? {}
    const langs = new Set<string>()
    for (const source of sources) {
      for (const [lang, name] of Object.entries(source.names)) {
        if (name) langs.add(lang)
      }
    }
    return [...langs].sort().map((lang) => {
      const spellings: string[] = []
      const owners: Owner[][] = []
      const push = (value: string, owner: Owner): void => {
        const index = spellings.indexOf(value)
        if (index >= 0) owners[index].push(owner)
        else {
          spellings.push(value)
          owners.push([owner])
        }
      }
      const targetName = targetNames[lang]
      if (targetName) push(targetName, 'target')
      sources.forEach((source, index) => {
        const name = source.names[lang]
        if (name) push(name, index + 1)
      })
      return {
        lang,
        spellings,
        owners,
        targetHas: Boolean(targetName),
        needsChoice: spellings.length > 1
      }
    })
  }, [sources, targetEntity])

  /** 需要用户决定的语言数 */
  const supersededCount = preview.filter((row) => row.needsChoice).length

  const ownersTextOf = (row: PreviewRow, value: string): string => {
    const index = row.spellings.indexOf(value)
    const owners = index >= 0 ? row.owners[index] : []
    return owners.map(ownerText).join(t('merge.preview.ownerJoiner'))
  }

  const isCustom = (lang: string): boolean => nameChoice[lang] === CUSTOM

  /** 「修改为」输入框的起点：第一条源在这个语言的写法（那是「想改掉的那个」），没有就退回默认 */
  const customBase = (row: PreviewRow): string => {
    const fromSource = sources.find((source) => source.names[row.lang])
    return fromSource?.names[row.lang] ?? row.spellings[0]
  }

  /** 这个语言最终会用哪个写法 */
  const effectiveOf = (row: PreviewRow): string =>
    isCustom(row.lang)
      ? (customNames[row.lang] ?? customBase(row))
      : (nameChoice[row.lang] ?? row.spellings[0])

  /**
   * 选项样式：**朴素版**（不要边框、不要主色底 —— 用户说那太重）。
   * 选中态只靠「文字变前景色 + 加粗」表达，配合下面加强过的 radio 本体一起看。
   */
  const optionClass = (active: boolean): string =>
    cn(
      'flex cursor-pointer items-center gap-1.5 text-xs',
      active ? 'font-medium text-foreground' : 'font-normal text-muted-foreground'
    )

  /**
   * radio 本体的加强样式。
   *
   * ⚠️ 用户反馈过「第一时间看不出这是单选框」：shadcn 默认的 `border-input` 是给白底表单
   * 设计的，放进 `bg-muted/40` 的预览块里几乎看不见（我又把尺寸缩到 14px，更糟）。
   * 默认样式在深/浅主题下都不够，所以这里换成深边框 + 背景色 + 放大的圆点。
   */
  const radioItemClass = cn(
    'size-4 border-muted-foreground bg-background',
    'data-[state=checked]:border-primary',
    '[&_svg]:size-2.5'
  )

  /**
   * 提交用的 `namesOverride`：每个语言最终要用什么写法。
   * 与默认（`spellings[0]`）一致的**不写** —— 那本来就是主进程的行为。
   */
  const namesOverride: Record<string, string> = {}
  for (const row of preview) {
    if (!row.needsChoice) continue
    const value = effectiveOf(row).trim()
    if (value && value !== row.spellings[0]) namesOverride[row.lang] = value
  }

  /** 真正会被并掉的那些 */
  const otherKeys = target ? keys.filter((key) => key !== target) : []

  const handleConfirm = async (): Promise<void> => {
    if (!target || otherKeys.length === 0) return
    setIsSaving(true)
    try {
      // 逐条并进目标；`namesOverride` 每次一样，最后一遍落定最终写法
      for (const from of otherKeys) {
        await ipcManager.invoke('tag-lexicon:merge', { from, into: target, namesOverride })
      }
      toast.success(
        otherKeys.length > 1
          ? t('merge.notification.mergedMulti', { count: otherKeys.length })
          : t('merge.notification.merged')
      )
      onOpenChange(false)
      setTarget(null)
      onDone?.()
    } catch (error) {
      console.error('[TagLexicon] Failed to merge the tags:', error)
      toast.error(t('merge.notification.failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('w-[560px] max-w-[90vw]')}>
        <DialogHeader>
          {/* 实体名可以很长（vndb 里最长的 80+ 字符），标题与描述都要允许换行 */}
          <DialogTitle className={cn('break-words')}>
            {fromLabel && keys.length === 1
              ? t('merge.title', { name: fromLabel })
              : t('merge.titleMulti', { count: keys.length })}
          </DialogTitle>
          {/* 描述里有换行（「同语言以目标为准」那一条单独一行），所以要 `whitespace-pre-line` */}
          <DialogDescription className={cn('break-words whitespace-pre-line')}>
            {keys.length === 1 ? t('merge.description') : t('merge.descriptionMulti')}
          </DialogDescription>
        </DialogHeader>

        {isBulk ? (
          /*
           * 多选合并：目标在选中的这几条里挑（默认 = 最后点选的那条）。
           * 这里不给搜索框 —— 「把选中的并成一条」就是这一步的语义；要并到别的实体上，
           * 用那一行的「合并到…」（单条路径，目标可自由搜）。
           *
           * ⚠️ chip 上必须带线索摘要：候选里的两条**显示名常常一字不差**（「潮吹」vs「潮吹」），
           * 只写显示名根本分不清点的是哪条（2026-09-24 用户在 `EntityPicker` 的「已选」行
           * 上报过同一个问题）。
           */
          <div className={cn('flex min-w-0 flex-wrap items-center gap-2')}>
            <span className={cn('shrink-0 text-xs text-muted-foreground')}>
              {t('merge.target')}
            </span>
            {candidates.map((entity, index) => (
              <button
                key={entity.key}
                type="button"
                onClick={() => setTarget(entity.key)}
                className={cn(
                  'flex max-w-[18rem] min-w-0 flex-col items-start gap-0.5 rounded-md border px-2 py-1 text-left text-xs transition-colors',
                  entity.key === target
                    ? 'border-primary font-medium'
                    : 'border-border text-muted-foreground hover:bg-accent'
                )}
              >
                <span className={cn('flex max-w-full min-w-0 items-center gap-1.5')}>
                  <span className={cn('shrink-0 text-[10px] text-muted-foreground/70')}>
                    {index + 1}
                  </span>
                  <span className={cn('truncate')}>{entity.display}</span>
                </span>
                <span
                  className={cn('w-full truncate text-[10px] font-normal text-muted-foreground/70')}
                  title={clueSummary(entity) || entity.key}
                >
                  {clueSummary(entity) || entity.key}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EntityPicker
            value={target}
            onChange={setTarget}
            exclude={keys}
            placeholder={t('merge.targetPlaceholder')}
          />
        )}

        {preview.length > 0 && (
          <div className={cn('flex min-w-0 flex-col gap-2 rounded-md bg-muted/40 px-2.5 py-2')}>
            <span className={cn('text-xs font-medium')}>{t('merge.preview.title')}</span>
            {preview.map((row) => {
              const kept = effectiveOf(row)

              return (
                <div key={row.lang} className={cn('flex min-w-0 flex-col gap-1 text-xs')}>
                  <div className={cn('flex min-w-0 flex-wrap items-baseline gap-x-1.5')}>
                    <span className={cn('w-14 shrink-0 text-muted-foreground')}>{row.lang}</span>
                    {row.needsChoice ? (
                      /*
                       * 候选写法**固定按「目标 → 本条① → 本条②…」排**，不留的那些划掉 ——
                       * 位置不随选择变，只有删除线会挪，所以不用画箭头（2026-09-25 用户定稿：
                       * 「保留的情况改为 A（目标） B（本条），这里划掉文本」）。
                       */
                      <span className={cn('flex min-w-0 flex-wrap items-baseline gap-x-3')}>
                        {row.spellings.map((spelling) => {
                          const isKept = spelling === kept
                          return (
                            <span
                              key={spelling}
                              className={cn('flex min-w-0 items-baseline gap-1')}
                            >
                              <span
                                className={cn(
                                  'min-w-0 break-words',
                                  isKept ? 'font-medium' : 'text-muted-foreground line-through'
                                )}
                              >
                                {spelling}
                              </span>
                              <span className={cn('text-[10px] text-muted-foreground/70')}>
                                {t('merge.preview.ownerTag', {
                                  owner: ownersTextOf(row, spelling)
                                })}
                              </span>
                            </span>
                          )
                        })}
                        {/* 「修改为」：候选全部划掉，末尾跟上用户敲的值（没有来源就不标） */}
                        {isCustom(row.lang) && (
                          <span className={cn('min-w-0 break-words font-medium')}>{kept}</span>
                        )}
                      </span>
                    ) : (
                      <>
                        <span className={cn('min-w-0 break-words')}>{row.spellings[0]}</span>
                        {!row.targetHas && (
                          <span className={cn('text-[10px] text-muted-foreground')}>
                            {t('merge.preview.gained')}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {/* 写法不止一个时才需要选：留哪个（最后一个选项可以自己填） */}
                  {row.needsChoice && (
                    /*
                     * 外层这圈 flex 是为了让「修改为」的输入框能**紧跟在这个选项后面**
                     * （而不是另起一行）：`RadioGroup` 和 `Input` 并排放在同一个 flex 行里，
                     * 空间不够时它俩一起换行，输入框仍贴在「修改为」右侧。
                     */
                    <div
                      className={cn('flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 pl-14')}
                    >
                      <RadioGroup
                        className={cn('flex flex-wrap items-center gap-x-4 gap-y-1')}
                        value={isCustom(row.lang) ? CUSTOM : kept}
                        onValueChange={(value) =>
                          setNameChoice((prev) => ({ ...prev, [row.lang]: value }))
                        }
                      >
                        {row.spellings.map((spelling, index) => {
                          /** 与默认一致的那个就是「保留」，其余都是「覆盖」 */
                          const isKeep = spelling === row.spellings[0]
                          return (
                            <Label
                              key={spelling}
                              htmlFor={`merge-keep-${row.lang}-${index}`}
                              className={cn(optionClass(!isCustom(row.lang) && kept === spelling))}
                            >
                              <RadioGroupItem
                                value={spelling}
                                id={`merge-keep-${row.lang}-${index}`}
                                className={cn(radioItemClass)}
                              />
                              {isKeep
                                ? t('merge.preview.keep')
                                : sources.length > 1
                                  ? t('merge.preview.overwriteOwner', {
                                      owner: ownersTextOf(row, spelling)
                                    })
                                  : t('merge.preview.overwrite')}
                            </Label>
                          )
                        })}
                        <Label
                          htmlFor={`merge-keep-custom-${row.lang}`}
                          className={cn(optionClass(isCustom(row.lang)))}
                        >
                          <RadioGroupItem
                            value={CUSTOM}
                            id={`merge-keep-custom-${row.lang}`}
                            className={cn(radioItemClass)}
                          />
                          {t('merge.preview.keepCustom')}
                        </Label>
                      </RadioGroup>
                      {isCustom(row.lang) && (
                        <Input
                          // 预填第一条源在这个语言的写法 —— 它是「想改掉的那个」的自然起点，
                          // 也让「修改为」永远有值（留空就等于没选，会退回默认）
                          value={customNames[row.lang] ?? customBase(row)}
                          onChange={(event) =>
                            setCustomNames((prev) => ({ ...prev, [row.lang]: event.target.value }))
                          }
                          placeholder={t('merge.preview.customPlaceholder')}
                          aria-label={t('merge.preview.customPlaceholder')}
                          /*
                           * ⚠️ 必须连 `md:` 一起覆盖：`ui/input.tsx` 默认是
                           * `text-base md:text-sm`，而 tailwind-merge 把带修饰符的
                           * `md:text-sm` 当**另一组**、不会因为 `text-xs` 被移除 →
                           * 窗口 ≥768px 时字号仍是 14px，比旁边的选项文字（12px）大一号。
                           *
                           * ⚠️ 用**固定小宽度**、别用 `flex-1`：拉满剩余宽度会把这一行
                           * 视觉上撑开（用户：「到『修改为』时布局被输入框撑开了」）。
                           * 高度压到 `h-5`，与旁边的 `text-xs` 文字几乎等高。
                           */
                          className={cn('h-5 w-36 shrink-0 px-1.5 py-0 text-xs md:text-xs')}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {supersededCount > 0 && (
              <span className={cn('break-words text-[11px] text-muted-foreground')}>
                {t('merge.preview.supersededWarn', { count: supersededCount })}
              </span>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button disabled={isSaving || !target || otherKeys.length === 0} onClick={handleConfirm}>
            {isSaving ? t('actions.saving') : t('merge.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
