import type {
  GameTagMigrationResult,
  TagLexiconAddSourceParams,
  TagLexiconConflict,
  TagLexiconConflictResolveParams,
  TagLexiconDeleteTagParams,
  TagLexiconDisplayMapParams,
  TagLexiconEnsureManyParams,
  TagLexiconEnsureParams,
  TagLexiconExportParams,
  TagLexiconExportResult,
  TagLexiconGetEntitiesParams,
  TagLexiconImportParams,
  TagLexiconImportResult,
  TagLexiconMergeParams,
  TagLexiconMigrateGameTagsParams,
  TagLexiconMoveSourceParams,
  TagLexiconMoveSourceResult,
  TagLexiconQueryParams,
  TagLexiconQueryResult,
  TagLexiconRemoveSourceParams,
  TagLexiconRemoveSourceResult,
  TagLexiconResolveParams,
  TagLexiconSetNameParams,
  TagLexiconState
} from '@appTypes/models'
import { dialog } from 'electron'
import fse from 'fs-extra'

import { ipcManager } from '~/core/ipc'
import { getTagLanguage } from '~/features/system/services/i18n'
import { migrateGameTags, TagLexiconManager } from './services'

export function setupTagLexiconIPC(): void {
  // 主动把单例建起来：它构造时会读词库文件、跑一次老 key 迁移（`migrateLegacyBuiltinKeys`）
  // 并启动文件监听。不预热的话这些都要等用户第一次碰标签才发生 —— 期间文件里可能还留着
  // 已经被淘汰的 key 形式，被同步/备份出去就又传染给别人。
  TagLexiconManager.getInstance()

  ipcManager.handle('tag-lexicon:get-state', async (): Promise<TagLexiconState> => {
    return TagLexiconManager.getInstance().getState(getTagLanguage())
  })

  ipcManager.handle(
    'tag-lexicon:query',
    async (_, params: TagLexiconQueryParams): Promise<TagLexiconQueryResult> => {
      const manager = TagLexiconManager.getInstance()
      return manager.query(
        params?.lang || getTagLanguage(),
        params?.keyword ?? '',
        params?.limit ?? 200,
        params?.offset ?? 0,
        params?.scope ?? 'all'
      )
    }
  )

  /** 按 key 批量取实体：冲突面板要同时展示冲突双方的名字与线索 */
  ipcManager.handle('tag-lexicon:get-entities', async (_, params: TagLexiconGetEntitiesParams) => {
    const manager = TagLexiconManager.getInstance()
    const lang = params?.lang || getTagLanguage()
    return (params?.keys ?? [])
      .map((key) => manager.getEntity(key, lang))
      .filter((entity) => entity !== null)
  })

  ipcManager.handle('tag-lexicon:set-name', async (_, params: TagLexiconSetNameParams) => {
    await TagLexiconManager.getInstance().setName(params.key, params.lang, params.value)
  })

  ipcManager.handle('tag-lexicon:delete-tag', async (_, params: TagLexiconDeleteTagParams) => {
    await TagLexiconManager.getInstance().deleteTag(params.key)
  })

  /** 解析原始串 -> 实体 key；只读，不会铸新实体 */
  ipcManager.handle(
    'tag-lexicon:resolve',
    async (_, params: TagLexiconResolveParams): Promise<string | null> => {
      return TagLexiconManager.getInstance().resolve(params?.raw, params?.provider, params?.id)
    }
  )

  /** 解析并保证存在：未命中时现场铸造（扫描入库时用） */
  ipcManager.handle(
    'tag-lexicon:ensure',
    async (_, params: TagLexiconEnsureParams): Promise<string> => {
      return await TagLexiconManager.getInstance().ensureTag(
        params.raw,
        params.provider,
        params.id,
        params.lang
      )
    }
  )

  /**
   * 批量解析/铸造。渲染层手动编辑标签时，用户看到并改的是译名，
   * 保存前要把这一串文本统一还原成实体 key —— 认得出的复用已有实体，
   * 认不出的按当前界面语言铸成用户标签。
   */
  ipcManager.handle(
    'tag-lexicon:ensure-many',
    async (_, params: TagLexiconEnsureManyParams): Promise<string[]> => {
      const provider = params.provider || 'user'
      // 手工输入的标签没有源语言，按当前界面语言登记；抓取源自己的标签则交给
      // provider 的默认语言（vndb=en / dlsite·erogamescape=ja / bangumi=zh-Hans），
      // 这里不能一律套用界面语言，否则日文标签会被记成中文名。
      const lang = params.lang || (provider === 'user' ? getTagLanguage() : undefined)
      return await TagLexiconManager.getInstance().ensureTags(params.values ?? [], provider, lang)
    }
  )

  /** 批量取显示名：数据库里存的是 key，渲染层靠这个映射显示当前语言 */
  ipcManager.handle(
    'tag-lexicon:display-map',
    async (_, params: TagLexiconDisplayMapParams): Promise<Record<string, string>> => {
      return TagLexiconManager.getInstance().displayMap(
        params?.lang || getTagLanguage(),
        params?.keys
      )
    }
  )

  ipcManager.handle('tag-lexicon:merge', async (_, params: TagLexiconMergeParams) => {
    await TagLexiconManager.getInstance().merge(params.from, params.into, params.namesOverride)
  })

  /**
   * 待处理的标签冲突（含已忽略的，UI 里分区展示）。
   *
   * 为什么要有这个入口：入库不再自动按文本归并（`resolveOrMint` 只认源内稳定 id），
   * 「两个概念撞同一个词」和「抓取写法和已有译名不一致」都会落到这里由人决定。
   */
  ipcManager.handle('tag-lexicon:conflicts', async (): Promise<TagLexiconConflict[]> => {
    return await TagLexiconManager.getInstance().listConflicts()
  })

  /** 处理一条冲突：`accept` 采纳 / `keep` 保留现状（并记住别再问） */
  ipcManager.handle(
    'tag-lexicon:conflict-resolve',
    async (_, params: TagLexiconConflictResolveParams) => {
      await TagLexiconManager.getInstance().resolveConflict(params.id, params.action)
    }
  )

  /**
   * 改挂：把某个源在某条实体上的全部线索移到另一条实体上（两条实体都还在）。
   * 返回真实结果 —— 内置表提供的线索挪不动，UI 必须知道这点，否则会报假成功。
   */
  ipcManager.handle(
    'tag-lexicon:move-source',
    async (_, params: TagLexiconMoveSourceParams): Promise<TagLexiconMoveSourceResult> => {
      return TagLexiconManager.getInstance().moveSource(params.from, params.into, params.provider)
    }
  )

  /** 摘掉某个源在某条实体上的全部线索（不改挂，直接断开），同样返回真实结果 */
  ipcManager.handle(
    'tag-lexicon:remove-source',
    async (_, params: TagLexiconRemoveSourceParams): Promise<TagLexiconRemoveSourceResult> => {
      return TagLexiconManager.getInstance().removeSource(params.key, params.provider)
    }
  )

  /**
   * 一次性维护动作：把全库游戏文档里还没迁移的标签原文换成实体 key。
   * 先 `dryRun` 看影响面，再真跑；词库管理页的「转换已有标签」按钮走的就是这两个步骤。
   */
  ipcManager.handle(
    'tag-lexicon:migrate-game-tags',
    async (_, params: TagLexiconMigrateGameTagsParams): Promise<GameTagMigrationResult> => {
      return await migrateGameTags(params ?? {})
    }
  )

  /**
   * 登记跨源等价写法：把某源返回的原始串挂到已有实体上。
   * 之后扫描该源时这条串就直接命中该实体，不会再铸出重复条目 —— 这是手工跨源归并
   * 的首选手段（比 merge 更「向前看」：merge 只重定向已有数据，这个直接堵住新数据）。
   */
  ipcManager.handle(
    'tag-lexicon:add-source',
    async (_, params: TagLexiconAddSourceParams): Promise<void> => {
      await TagLexiconManager.getInstance().addSource(
        params.key,
        params.provider,
        params.raw,
        params.id
      )
    }
  )

  ipcManager.handle('tag-lexicon:reload', async () => {
    TagLexiconManager.getInstance().reload()
  })

  /** 导出：弹保存对话框，把词库写成 JSON 文件 */
  ipcManager.handle(
    'tag-lexicon:export',
    async (_, params: TagLexiconExportParams): Promise<TagLexiconExportResult> => {
      const manager = TagLexiconManager.getInstance()
      const suffix = params?.lang ? `.${params.lang}` : ''
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `tag-lexicon${suffix}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (canceled || !filePath) return { canceled: true }

      await fse.writeFile(filePath, manager.exportUser(params?.lang), 'utf-8')
      return { canceled: false, path: filePath }
    }
  )

  /** 导入：弹打开对话框，读取 JSON 后按 merge/replace 合并进词库 */
  ipcManager.handle(
    'tag-lexicon:import',
    async (_, params: TagLexiconImportParams): Promise<TagLexiconImportResult> => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (canceled || filePaths.length === 0) {
        return { canceled: true, added: 0, updated: 0, languages: [] }
      }

      const content = await fse.readFile(filePaths[0], 'utf-8')
      const result = await TagLexiconManager.getInstance().importUser(
        content,
        params?.mode ?? 'merge'
      )
      return { canceled: false, ...result }
    }
  )
}
