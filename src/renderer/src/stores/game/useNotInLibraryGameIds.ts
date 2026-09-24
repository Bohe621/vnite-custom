import { useMemo } from 'react'
import { useGameRegistry } from './gameRegistry'
import { isGameMissingFromLibrary, useGamePathStore } from './gamePathStore'

/**
 * Games that are no longer in the library: records still live in the database, but every
 * directory their versions point at is gone from disk.
 *
 * Only the "all games" list hides them — collections, recent games and search keep showing them,
 * so a game can never become unreachable just because its folder moved.
 */
export function useNotInLibraryGameIds(sourceGameIds?: readonly string[]): string[] {
  const registryGameIds = useGameRegistry((state) => state.gameIds)
  const gameDirectories = useGamePathStore((state) => state.gameDirectories)
  const paths = useGamePathStore((state) => state.paths)

  return useMemo(() => {
    const gameIds = sourceGameIds ? Array.from(sourceGameIds) : registryGameIds

    return gameIds.filter(
      (gameId) => isGameMissingFromLibrary(gameId, gameDirectories, paths) === true
    )
  }, [sourceGameIds, registryGameIds, gameDirectories, paths])
}

/** Whether this single game has lost every directory its versions point at. */
export function useIsGameMissingFromLibrary(gameId: string): boolean {
  const gameDirectories = useGamePathStore((state) => state.gameDirectories)
  const paths = useGamePathStore((state) => state.paths)

  return useMemo(
    () => isGameMissingFromLibrary(gameId, gameDirectories, paths) === true,
    [gameId, gameDirectories, paths]
  )
}
