/**
 * 用户自建的「标签主数据」（tag lexicon）共享类型。
 *
 * 词库文件位于 <userData>/app/database/tag-lexicon.json，用户可直接编辑。
 * 设计要点（与 v1 的「原文 -> 译文」翻译表不同）：
 * - 一个标签 = 一条实体，key 是内部稳定标识，与「名字」分离；
 * - `names` 存各语言的显示名，`src` 存各抓取源返回的原始串，`ids` 存各源自己的稳定 id；
 * - 归并用 `redirects` 做重定向，原记录保留在 `backup` 里可撤销；
 * - 数据库里存的是 key，显示时再按当前语言解析，所以切语言不影响筛选。
 */

/**
 * 一条标签实体的可持久化内容。
 * 注意：内置表（vndb 标签的英→中对照）不写进文件，运行时作为「虚拟实体」参与合并，
 * 所以文件里只保留用户真正改动过的部分，上游更新内置表时能自动生效。
 */
export interface TagLexiconTagRecord {
  /** 语言代码 -> 该语言下的显示名（**用户与内置**的权威名，不含抓取自动积累的） */
  names: Record<string, string>
  /** 抓取源 -> 该源返回的原始标签串（vndb 存英文名，dlsite 存该语言下的分类名） */
  src?: Record<string, string[]>
  /** 抓取源 -> 该源自己的稳定 id（vndb 形如 `g82`，dlsite 形如 `genre:288` / `type:RPG`） */
  ids?: Record<string, string[]>
  /**
   * 抓取自动积累的语言名（**不是用户编辑的**）。
   *
   * 为什么不直接写进 `names`：区分「谁写的」会影响两件事 ——
   * 1. `isUserTouched()` 判定：混进 `names` 会让**内置实体**被判成 user，
   *    于是「内置」徽标消失、`userCount` 虚涨（只被扫过一遍就看着像用户数据）；
   * 2. `exportUser()` 导出：混进 `names` 会把机器抓来的名字当作用户译名导出去。
   *
   * 显示优先级：**用户 `names` > 内置 `names` > `fetchedNames`**（在 `rebuild()` 里合并）。
   * 典型来源：DLsite 中文站给 `genre:288` 带来「主从/主仆」、日文站带来「主従」，
   * 靠 id 归并到同一条实体后，两种语言就都攒下来了。
   */
  fetchedNames?: Record<string, string>
}

/** 已合并条目的重定向记录 */
export interface TagLexiconRedirectRecord {
  /** 合并到的目标 key */
  to: string
  /** 合并前的原记录快照，便于日后撤销 */
  backup?: TagLexiconTagRecord
  /** 合并时间（ISO 8601） */
  at?: string
}

/**
 * 标签冲突的种类。入库时**不再**自动按文本归并（见 `resolveOrMint`），
 * 于是两种「需要人来决定」的情形会浮出来，都记成冲突交给「冲突管理」：
 * - `duplicate`：新铸的实体在某个语言下的名字，与**另一条**已有实体同名 —— 两个概念用了同一个词。
 *   典型：DLsite 作品形式「角色扮演」（`type:RPG`，指 RPG 类型）撞上 vndb `Cosplay` 的中文译名。
 *   同义还是不同义只有人看得出来（`兽耳` 是真同义、`角色扮演` 是假同义）。
 * - `name`：**同一条**实体在该语言下已经有另一个名字 —— 抓取到的写法与内置/用户译名不一致。
 *   最有价值的是「用户手改过译名，之后扫描又抓到别的写法」，以前这种情况是静默跳过的。
 */
export type TagLexiconConflictKind = 'duplicate' | 'name'

/**
 * 冲突的处理状态。
 * `ignored` 是「保留现状、以后别再问」——按 (kind, 实体, 语言, 源, 名字) 记住，
 * 所以同一个写法不会反复弹；但换成另一个写法还会再问一次。
 */
export type TagLexiconConflictStatus = 'pending' | 'ignored'

export interface TagLexiconConflict {
  /** 稳定标识，用于跨会话定位（由 `conflictIdOf()` 算出，展示时可当 opaque id） */
  id: string
  kind: TagLexiconConflictKind
  /** `duplicate`：新铸的那条实体；`name`：已有实体 */
  key: string
  /** 冲突所在的语言 */
  lang: string
  /** 产生这条观察的抓取源 */
  provider: string
  /** 抓取源返回的名字 */
  incoming: string
  /** `duplicate`：与之同名的另一条实体 */
  other?: string
  /** `name`：该实体当前生效的名字 */
  current?: string
  /** `name`：当前名字的持有者（决定「采纳抓取名」会不会覆盖用户的编辑） */
  currentOrigin?: 'builtin' | 'user' | 'fetched'
  /** 这条观察对应的源内稳定 id（如有） */
  ids?: string[]
  status: TagLexiconConflictStatus
  /** 首次记录时间（ISO 8601） */
  at: string
}

export interface TagLexiconFile {
  version: 2
  /**
   * 「精确命中」与「同语族命中」都没结果时，额外按顺序尝试的语言。
   * 默认 ['en']；同语族的互回退（zh-Hans <-> zh-Hant）由代码自动处理，不需要写在这里。
   */
  fallback: string[]
  /** key -> 标签实体。key 语法：`@<命名空间>:<局部标识>` */
  tags: Record<string, TagLexiconTagRecord>
  /** 已合并掉的旧 key -> 重定向记录 */
  redirects: Record<string, TagLexiconRedirectRecord>
  /**
   * 待处理/已忽略的标签冲突。跟词库放在同一个文件里，理由与 `redirects` 一致：
   * 它是这份词库的**编辑状态**，用户导出/换设备时应该一起走；
   * 「已忽略」更是一条明确的编辑决定，不该只留在本机。
   */
  conflicts?: TagLexiconConflict[]
}

/** 一条标签实体（内置表与用户词库合并后的最终视图） */
export interface TagLexiconEntity {
  key: string
  /**
   * 当前语言下的显示名，**已含回退**（该语言没有时会落到 fallback 链乃至其他语言）。
   * ⚠️ 别拿它当编辑框的占位符：选 ja 时这里会是英文，看起来像「ja 已有数据」。
   * 判断「该语言是否真有译名」一律查 `names[lang]`。
   */
  display: string
  /** 全部语言的显示名 */
  names: Record<string, string>
  /** 各源原始串 */
  src: Record<string, string[]>
  /** 各源稳定 id */
  ids: Record<string, string[]>
  /** 该条目的来源：内置表 or 用户改动过 */
  origin: 'builtin' | 'user'
}

export interface TagLexiconState {
  /** 词库文件绝对路径，便于用户直接在编辑器里打开 */
  path: string
  /** 全局补充回退链（同语族回退之外的额外语言） */
  fallback: string[]
  /** 词库里出现过的所有语言 */
  languages: string[]
  /** 各语言已有译名的实体数（管理页显示覆盖率用） */
  languageCounts: Record<string, number>
  /** 有效实体总数（内置 + 用户） */
  tagCount: number
  /** 用户文件里新建或改动过的实体数 */
  userCount: number
  /** 未被用户改动、直接来自内置表的实体数 */
  builtinCount: number
  /** 已合并（重定向）条目数 */
  mergedCount: number
  /** 待处理的标签冲突数（`status === 'pending'`） */
  conflictCount: number
  /** 当前界面语言 */
  currentLang: string
}

/**
 * 管理页列表的过滤范围：按「这条实体有没有当前语言的译名」筛选。
 * - `all`：全部实体
 * - `withName`：只列已有该语言译名的（该语言真正有数据的部分）
 * - `missingName`：只列缺少该语言译名的（补译名时用）
 */
export type TagLexiconQueryScope = 'all' | 'withName' | 'missingName'

export interface TagLexiconQueryParams {
  /** 用于计算 display 的语言；不传则由主进程按界面语言兜底 */
  lang?: string
  keyword?: string
  limit?: number
  offset?: number
  /** 不传按 `all` */
  scope?: TagLexiconQueryScope
}

export interface TagLexiconQueryResult {
  total: number
  entities: TagLexiconEntity[]
}

/** 按 key 取实体（冲突面板要同时展示冲突双方的名字与线索，列表查询按关键词做不到） */
export interface TagLexiconGetEntitiesParams {
  keys: string[]
  /** 用于计算 `display` 的语言 */
  lang?: string
}

export interface TagLexiconSetNameParams {
  /** 实体 key */
  key: string
  /** 要写入的语言 */
  lang: string
  /** 留空表示移除该语言的译名；移除后实体若已无任何译名则整条删除 */
  value: string
}

export interface TagLexiconDeleteTagParams {
  key: string
}

export interface TagLexiconResolveParams {
  /** 抓取源返回的原始串，也可以直接传内部 key（以 @ 开头） */
  raw: string
  provider?: string
  /** 该源自己的稳定 id，可选 */
  id?: string
}

export interface TagLexiconEnsureParams {
  raw: string
  provider: string
  id?: string
  /** 铸造新实体时登记显示名用的语言；手工输入的标签没有源语言，由调用方传当前界面语言 */
  lang?: string
}

/**
 * 批量解析/铸造：把用户编辑后的一串标签文本转回实体 key。
 * 手动编辑标签时用户看到的是译名，写库前要统一还原成 key。
 */
export interface TagLexiconEnsureManyParams {
  values: string[]
  provider: string
  lang?: string
}

/**
 * 登记「某源的某个原始串/源 id 等价于这条实体」，用于手工跨源映射。
 * 例：把 ErogameScape 的日文「寝取られ」挂到 vndb 的 `Netorare` 实体上。
 */
export interface TagLexiconAddSourceParams {
  /** 目标实体 key */
  key: string
  /** 抓取源名（vndb / bangumi / dlsite / erogamescape ...） */
  provider: string
  /** 该源返回的原始串 */
  raw: string
  /** 该源自己的稳定 id，可选 */
  id?: string
}

export interface TagLexiconDisplayMapParams {
  lang?: string
  /** 只算这些 key 的显示名；不传则返回全部 */
  keys?: string[]
}

export interface TagLexiconMergeParams {
  /** 被合并掉的 key */
  from: string
  /** 合并到的目标 key */
  into: string
  /**
   * 这些语言的译名**直接用这里给的写法**（不传则以目标为准）。
   *
   * 译名是按语言合并的 —— 一个语言只能有一个显示名，两边同语言都有写法时必然要丢一个，
   * 默认是丢本条的（`unionNames` 里 extra 覆盖 base）。合并对话框里用户逐语言选过之后，
   * 结果写在这里：`保留本条` 写本条的写法、`自己输入` 写用户填的值（`保留目标` 不写）。
   *
   * 之所以传「具体写法」而不是「选了哪一边」：自定义输入没法表达成偏好，而主进程也
   * 不该去猜 UI 的三个选项分别意味着什么。
   */
  namesOverride?: Record<string, string>
}

/**
 * 处理一条标签冲突。
 * - `accept`：`duplicate` 走 merge（把新实体并进已有那条）；`name` 把抓到的写法写成该语言的译名
 * - `keep`：保留现状，并把这条冲突标成 `ignored`，同一个写法以后不再问
 */
export interface TagLexiconConflictResolveParams {
  /** `TagLexiconConflict.id` */
  id: string
  action: 'accept' | 'keep'
}

/**
 * 把「某条实体上的某个源的全部线索」挪到另一条实体上（改挂）。
 *
 * 单位是**源**而不是单条原始串：一条实体在一个源上只会对应一个概念，
 * 而 src 与 ids 是两个平行数组、下标并不一一对应（DLsite 的 `角色扮演`/`ロールプレイング`
 * 两个语言的写法共用一个 `type:RPG`），所以只能整块挪。
 */
export interface TagLexiconMoveSourceParams {
  from: string
  into: string
  provider: string
}

/** 摘掉某条实体上某个源的全部线索（不改挂，直接断开） */
export interface TagLexiconRemoveSourceParams {
  key: string
  provider: string
}

/** 改挂 / 断开里「一对线索列表」，`src` 是原文、`ids` 是源内稳定 id */
export interface TagLexiconClueSet {
  src: string[]
  ids: string[]
}

/**
 * 改挂的结果。
 *
 * 之所以要返回结果而不是 `void`：**内置表提供的那部分线索挪不动**。内置表来自
 * `getBuiltinTags()`（代码里的权威数据），不在用户词库文件里，摘了也会在下一次
 * `rebuild()` 里加回来。早先这种情况是静默 `return` 的，于是 UI 弹出「已改挂成功」
 * 而磁盘上什么都没变 —— 用户看到线索「依旧在」，只能猜是不是被合并了。
 */
export interface TagLexiconMoveSourceResult {
  /** 真正被挪到目标实体上的线索 */
  moved: TagLexiconClueSet
  /** 来自内置表、用户改不动的线索（非空说明这个源只挪走了一部分，或完全没动） */
  blocked: TagLexiconClueSet
  /** 改挂之后源实体是否已没有任何来源线索（只剩名字）—— 这种多半该删或该并 */
  sourceIsShell: boolean
}

/** 断开的结果，语义同 `TagLexiconMoveSourceResult`（`detached` 对应 `moved`） */
export interface TagLexiconRemoveSourceResult {
  /** 真正被摘掉的线索 */
  detached: TagLexiconClueSet
  /** 来自内置表、摘不掉的线索 */
  blocked: TagLexiconClueSet
  /** 断开之后源实体是否已没有任何来源线索（只剩名字） */
  sourceIsShell: boolean
}

// ---------------------------------------------------------------------------------------------
// 全库标签迁移：把 game 文档里还没迁移的老原文换成实体 key
// ---------------------------------------------------------------------------------------------

export interface TagLexiconMigrateGameTagsParams {
  /**
   * 只统计不写库。默认 `true` —— 这个操作会改全库文档，必须能先看一眼影响面。
   * 注意 dry-run 时**不会**铸新实体（否则「预览」也会改词库）。
   */
  dryRun?: boolean
  /**
   * 认不出的老原文要不要铸成新实体（provider 记 `user`、语言按当前界面语言）。
   * `false` 时它们原样保留 —— 表现和迁移前一样（显示层认不出就透传），只是没被统一。
   * dry-run 时这个开关只影响预估数字，不会真的铸。
   */
  mintUnknown?: boolean
}

export interface GameTagMigrationSample {
  gameId: string
  name: string
  before: string[]
  after: string[]
}

export interface GameTagMigrationResult {
  dryRun: boolean
  /** 有标签的游戏数 */
  games: number
  /** 值发生变化（会被写库）的游戏数 */
  gamesChanged: number
  /** 标签值总数（含重复） */
  values: number
  /** 本来就是 key 的 */
  alreadyKey: number
  /** 认出来、换成已有实体 key 的 */
  resolved: number
  /** 认不出、本次铸成新实体的（dryRun 或未开启铸造时为 0） */
  minted: number
  /** 认不出、保持原样的（出现次数） */
  unknown: number
  /**
   * 认不出的**不同写法**数量 —— 开启铸造时会铸这么多条新实体，dry-run 的预估也是它。
   * （`unknown` 是出现次数，两者差得远：`羞辱` 一个写法就可能出现在 43 个游戏里。）
   */
  unknownDistinct: number
  /** 前几条变化的 before/after，给用户核对 */
  samples: GameTagMigrationSample[]
  /** 认不出的值里出现最多的几个（关掉铸造时给用户看，决定要不要开） */
  unknownTop: { raw: string; count: number }[]
}

export interface TagLexiconExportParams {
  /** 不传则导出全部实体；传了则只导出在该语言下有译名的实体 */
  lang?: string
}

export interface TagLexiconExportResult {
  /** 用户在保存对话框里取消了 */
  canceled: boolean
  /** 实际写出的文件路径 */
  path?: string
}

export interface TagLexiconImportParams {
  /** merge = 只覆盖同名条目；replace = 清空后整体替换 */
  mode: 'merge' | 'replace'
}

/** 导入结果的纯数据部分（主进程词库服务返回） */
export interface TagLexiconImportSummary {
  added: number
  updated: number
  languages: string[]
}

/** 导入结果的 IPC 形态（含用户是否取消） */
export interface TagLexiconImportResult extends TagLexiconImportSummary {
  canceled: boolean
}
