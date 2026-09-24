import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { GameVersionScope, useGameState, useGameVersions } from '~/hooks'
import { cn } from '~/utils'
import { PropertiesDialogTab } from '../../store'
import { VersionSelecter } from '../../VersionSelecter'
import { Launcher, LauncherHandle } from './Launcher'
import { Media } from './Media'
import { Path, PathHandle } from './Path'
import { Record } from './Record'

export function GamePropertiesDialog({
  gameId,
  isOpen,
  setIsOpen,
  defaultTab
}: {
  gameId: string
  isOpen: boolean
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
  defaultTab?: PropertiesDialogTab
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [gameName] = useGameState(gameId, 'metadata.name')
  const [activeTab, setActiveTab] = useState<PropertiesDialogTab>(defaultTab ?? 'launcher')
  const { currentVersionId } = useGameVersions(gameId)

  /**
   * Which version the launcher/path tabs are editing. This is deliberately independent of the
   * version selected on the game detail page (which decides what gets launched); opening the
   * dialog just starts from whatever is currently the launch version.
   */
  const [editingVersionId, setEditingVersionId] = useState('')
  useEffect(() => {
    if (isOpen) setEditingVersionId(currentVersionId)
  }, [isOpen, currentVersionId])

  const pathRef = useRef<PathHandle>(null)
  const launcherRef = useRef<LauncherHandle>(null)

  async function saveActiveTab(): Promise<void> {
    if (activeTab === 'path') {
      await pathRef.current?.save()
    } else if (activeTab === 'launcher') {
      await launcherRef.current?.save()
    }
  }

  async function handleTabChange(newTab: string): Promise<void> {
    // When directly change tab after edit input, the change may not be saved
    await saveActiveTab()
    setActiveTab(newTab as PropertiesDialogTab)
  }

  async function handleVersionChange(nextVersionId: string): Promise<void> {
    if (nextVersionId === editingVersionId) return
    // Persist the in-progress edits to the version being left before switching away from it.
    await saveActiveTab()
    setEditingVersionId(nextVersionId)
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={async (open) => {
        if (!open) {
          await saveActiveTab()
        }
        setIsOpen(open)
      }}
    >
      <DialogContent className={cn('w-[70vw] h-[70vh] lg:h-[80vh] flex flex-col')}>
        <DialogHeader>
          <DialogTitle>{`${gameName} - ${t('detail.properties.title')}`}</DialogTitle>
        </DialogHeader>

        <GameVersionScope.Provider value={editingVersionId || null}>
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex-1 flex flex-col h-full"
          >
            <div className={cn('flex flex-row items-center justify-between gap-3')}>
              <TabsList className="">
                <TabsTrigger value="launcher">{t('detail.properties.tabs.launcher')}</TabsTrigger>
                <TabsTrigger value="path">{t('detail.properties.tabs.path')}</TabsTrigger>
                <TabsTrigger value="media">{t('detail.properties.tabs.media')}</TabsTrigger>
                <TabsTrigger value="record">{t('detail.properties.tabs.record')}</TabsTrigger>
              </TabsList>

              <VersionSelecter
                gameId={gameId}
                scope="edit"
                value={editingVersionId}
                onChange={(versionId) => void handleVersionChange(versionId)}
                className={cn('mr-1')}
              />
            </div>

            {/* -ml-1 and pl-1 to show the left shadow */}
            <ScrollArea className="h-[calc(95%-60px)] -ml-1">
              <TabsContent value="launcher" className="pr-5 pb-3 pl-1">
                <Launcher gameId={gameId} ref={launcherRef} />
              </TabsContent>

              <TabsContent value="path" className="pr-5 pb-3 pl-1">
                <Path gameId={gameId} ref={pathRef} />
              </TabsContent>

              <TabsContent value="media" className="pr-5 pb-3 pl-1">
                <Media gameId={gameId} />
              </TabsContent>

              <TabsContent value="record" className="pr-5 pb-3 pl-1">
                <Record gameId={gameId} />
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </GameVersionScope.Provider>
      </DialogContent>
    </Dialog>
  )
}
