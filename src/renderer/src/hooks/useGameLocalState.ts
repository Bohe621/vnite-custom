import { useCallback, useEffect, useState, useRef } from 'react'
import { getGameLocalStore } from '~/stores/game/gameLocalStoreFactory'
import type { gameLocalDoc } from '@appTypes/models'
import type { Get, Paths } from 'type-fest'
import { isEqual } from 'lodash'
import { scopePath, useGameVersionScope } from './useGameVersions'

export function useGameLocalState<
  Path extends Paths<gameLocalDoc, { bracketNotation: true }>,
  SaveMode extends boolean = false
>(
  gameId: string,
  path: Path,
  saveMode: SaveMode = false as SaveMode
): SaveMode extends true
  ? [
      Get<gameLocalDoc, Path>,
      (value: Get<gameLocalDoc, Path>) => void,
      () => Promise<void>,
      (value: Get<gameLocalDoc, Path>) => Promise<void>
    ]
  : [Get<gameLocalDoc, Path>, (value: Get<gameLocalDoc, Path>) => Promise<void>] {
  const gameLocalStore = getGameLocalStore(gameId)
  // Inside a version scope this resolves to `versions.<id>.<path>`, so the properties dialog
  // edits the version it has selected rather than the launch version.
  const versionId = useGameVersionScope()
  const effectivePath = scopePath(path as string, versionId)

  const initialValue = gameLocalStore.getState().getValueByString(effectivePath)

  // Use local state to store the current value
  const [localValue, setLocalValue] = useState<Get<gameLocalDoc, Path>>(initialValue)

  // Store the original value from the store (only used in save mode)
  const [originalValue, setOriginalValue] = useState<Get<gameLocalDoc, Path>>(initialValue)

  // Use ref to store the latest local values
  const localValueRef = useRef(localValue)
  localValueRef.current = localValue

  // Subscribe to store changes
  useEffect(() => {
    // Get the initial value and make sure it's synchronized with the store
    const currentValue = gameLocalStore.getState().getValueByString(effectivePath)
    if (!isEqual(currentValue, localValue)) {
      setLocalValue(currentValue)
      if (saveMode) {
        setOriginalValue(currentValue)
      }
    }

    const unsubscribe = gameLocalStore.subscribe((state) => {
      const newValue = state.getValueByString(effectivePath)
      if (!isEqual(newValue, localValueRef.current)) {
        setLocalValue(newValue)
        if (saveMode) {
          setOriginalValue(newValue)
        }
      }
    })

    return unsubscribe
  }, [gameId, effectivePath, saveMode])

  const setValue = useCallback(
    async (newValue: Get<gameLocalDoc, Path>) => {
      if (isEqual(newValue, localValue)) return

      if (saveMode) {
        // Save mode: Only update local state, don't modify the store
        setLocalValue(newValue)
      } else {
        // Immediate mode: Update local state first for immediate response
        setLocalValue(newValue)
        // Then update the store
        return gameLocalStore.getState().setValueByString(effectivePath, newValue)
      }
    },
    [saveMode, localValue, gameLocalStore, effectivePath]
  )

  const save = useCallback(async () => {
    if (!saveMode) return

    // Get the current value from the ref
    const currentValue = localValueRef.current

    if (isEqual(currentValue, originalValue)) return

    // Apply the local changes to the store
    await gameLocalStore.getState().setValueByString(effectivePath, currentValue)

    // Update original value to match the saved value
    setOriginalValue(currentValue)
  }, [saveMode, effectivePath, originalValue, gameLocalStore])

  const setValueAndSave = useCallback(
    async (newValue: Get<gameLocalDoc, Path>) => {
      if (isEqual(newValue, localValue) || !saveMode) return

      // Update local state
      setLocalValue(newValue)

      // Save directly to store
      await gameLocalStore.getState().setValueByString(effectivePath, newValue)

      setOriginalValue(newValue)
    },
    [localValue, gameLocalStore, effectivePath, saveMode]
  )

  if (saveMode) {
    return [localValue, setValue, save, setValueAndSave] as any
  } else {
    return [localValue, setValue] as any
  }
}
