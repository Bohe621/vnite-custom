import type { TagLexiconDisplayMapParams } from '@appTypes/models'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ipcManager } from '~/app/ipc'

/**
 * 标签显示名映射。
 *
 * 数据库里的 `metadata.tags` 存的是标签实体的 key（形如 `@vndb:lesbian sex`），
 * 界面上一律显示当前语言的译名。传进来的既可以是实体 key，也可以是迁移前的旧值
 * （中文 / 英文原文），主进程会先解析再取显示名，完全认不出来的原样返回 ——
 * 所以对尚未迁移的数据没有任何副作用。
 *
 * 返回的对象用**传入的原值**做键，调用处保持 `map[value] ?? value` 的写法即可，
 * 筛选比较仍然用原值（key），显示与取值天然分离。
 */
export function useTagDisplay(values: readonly string[]): Record<string, string> {
  const { i18n } = useTranslation()
  const lang = i18n.language

  const keys = useMemo(() => Array.from(new Set(values.filter((value) => !!value))), [values])
  // 用内容签名当依赖：调用方即使每次传新数组，只要内容不变就不会重复请求
  const signature = useMemo(() => keys.join('\u0000'), [keys])
  const keysRef = useRef(keys)
  keysRef.current = keys

  const [map, setMap] = useState<Record<string, string>>({})

  useEffect(() => {
    const currentKeys = keysRef.current
    if (currentKeys.length === 0) {
      setMap({})
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const params: TagLexiconDisplayMapParams = { keys: currentKeys }
        const result = await ipcManager.invoke('tag-lexicon:display-map', params)
        if (!cancelled) setMap(result)
      } catch (error) {
        console.error('[TagDisplay] Failed to resolve tag display names:', error)
        if (!cancelled) setMap({})
      }
    })()

    return () => {
      cancelled = true
    }
  }, [signature, lang])

  return map
}
