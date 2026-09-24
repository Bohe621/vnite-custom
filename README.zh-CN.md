<div align="center">
  <img src="https://img.timero.xyz/i/2025/07/31/688b10f8bccfc.png" width="128" height="128" alt="cover">

  <h1 align="center">
    Vnite
  </h1>

  <p align="center">
    <a href="https://www.electronjs.org/" target="_blank"><img src="https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron"></a>
    <a href="https://reactjs.org/" target="_blank"><img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React"></a>
    <a href="https://www.gnu.org/licenses/gpl-3.0.en.html" target="_blank"><img src="https://img.shields.io/badge/License-GPL%203.0-blue.svg?style=flat-square&logo=gnu&logoColor=white" alt="GPL-3.0 License"></a>
    </br>
    <a href="https://github.com/ximu3/vnite/stargazers"><img src="https://img.shields.io/github/stars/ximu3/vnite?color=ffcb47&labelColor=black&style=flat-square&logo=github&label=Stars" /></a>
    <a href="https://github.com/ximu3/vnite/graphs/contributors"><img src="https://img.shields.io/github/contributors/ximu3/vnite?style=flat-square&logo=github&label=Contributors&labelColor=black" /></a>
    <a href="https://github.com/ximu3/vnite/releases"><img src="https://img.shields.io/github/downloads/ximu3/vnite/total?color=369eff&labelColor=black&logo=github&style=flat-square&label=Downloads" /></a>
    <a href="https://t.me/+d65-R_xRx1JlYWZh" target="_blank"><img src="https://img.shields.io/badge/Telegram-2CA5E0?style=flat-square&logo=telegram&logoColor=white&labelColor=black" /></a>
  </p>
</div>

[English](README.md) | [简体中文](README.zh-CN.md)

> [!NOTE]
> **本仓库 fork 自 [ximu3/vnite](https://github.com/ximu3/vnite) 4.13.0 版本。**
> 根据自身需求，增加了 tag 多语言和游戏多版本。因为改造了数据结构，无法兼容旧数据，并且借助了不少AI的帮助，只有一点点小巧思，所以不敢提PR。如果刚好有同样需求的玩家，可以拿去试试，最好是没有使用过或者重建库不麻烦的因为不能保证能兼容旧数据。最后还是由衷感谢原项目的代码作者们提供了这么方便的工具。

Vnite 是一个多功能的游戏管理软件，旨在提供一个统一的用户界面来 记录、管理、同步 您的游戏之旅。

## ✨ 功能

- 现代化的用户界面（支持自定义主题）
- 支持插件扩展（内置插件市场）
- 所有游戏记录、存档、设置均支持多端实时云同步
- 支持多种数据源（Steam、IGDB、Bangumi、VNDB、YMGal、DLsite、Erogamescape）
- 灵活的元数据转换器，支持正则修改、替换、合并、排除任意元数据
- 支持游戏自动入库，每个扫描器都可自定义文件夹结构与数据源
- 提供细致的报告功能，支持年、月、周报告，便于回顾您的游戏之旅
- 支持与其他程序联动（如一键 LE 转区启动、自动Magpie缩放、模拟器启动等）
- 支持从 Steam 一键导入游戏库（保留游戏时间）
- 多样化的启动方式（文件、链接、脚本），支持高度自定义和预设配置
- 支持动态分类（按开发商、标签等）
- 强大的筛选器，支持自定义元数据字段
- 按次记录的计时器，支持记录单个文件或文件夹
- 支持通过系统链接唤醒并启动游戏
- 数据与程序完全分离，便于备份和自定义

## 🍴  fork 新增\优化功能

- **游戏多版本**：一个游戏可保存多个安装副本（不同版本），每个版本拥有独立的路径、启动方式与派生路径，启动器预设也可按版本分别应用。
- **多语言标签词库**：可自行编辑的标签实体表，同一概念跨数据源自动归并（依据源内稳定 id 或跨语言名称索引），支持多语言显示名，并提供归并、移动、迁移等管理功能。人话就是给不同元数据源但相同词义tag关联成一个tag，显示的是你当前选择的语言。(vndb的tag根据网上的一些词表做了翻译处理)
- **冲突管理**：扫描时若发现新游戏并且能匹配上库中已有的游戏、但位于其他目录（被移动、重新下载或为另一版本），会记录到冲突管理中，由你判断是否是其他版本。你的处理记录会被记下来，下次扫描时会自动跳过已处理的游戏。同理扫描到的新Tag也会记录到冲突管理中，由你判断是要和其他tag建立索引关联。这个管理页就是服务上面两个功能的。
- **DLsite 文件夹名解析**：优化了从文件夹名中识别中文标题与版本信息，取决于你的命名方式轨范。 例如[しなちくかすてぃーら][RJ269335] 夏色泡影 夏色のコワレモノ v1.05 就会被识别成原名:夏色のコワレモノ  译名:夏色泡影  版本号:v1.05 
- **NSFW 增强**：可将扫描目录标记为 NSFW，其下入库的游戏自动标记；顶部栏提供一键切换封面默认模糊。（欲盖弥彰，更容易让人怀疑了喂...
- **展示墙宽海报布局优化**：支持切换宽海报（3:2）展示，并优化了竖屏下的虚拟化滚动与图片加载。

## 本地开发

使用 Node.js 20.19+（20.x）或 22.12+，以及 `package.json` 中指定版本的 pnpm。
安装方式见 [pnpm 安装文档](https://pnpm.io/installation)。
构建 Windows 原生模块还需要 Rust MSVC 工具链，以及包含 Windows SDK 的 Visual Studio C++ 生成工具。

在项目根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build:native
pnpm dev
```

主应用与 `native` 包共用 workspace 和根目录的 `pnpm-lock.yaml`。
使用 `pnpm typecheck` 检查类型，`pnpm build` 编译项目，`pnpm build:win` 生成 Windows 安装包。
`pnpm build` 和 `pnpm build:win` 会自动构建原生模块。
`patches/` 中的依赖补丁由 pnpm 在安装时应用。

## 📸 截图

<details>
<summary>暗</summary>

![game](https://img.timero.xyz/i/2025/07/31/688b0785f0fd1.png)

</details>

<details>
<summary>明</summary>

![game](https://img.timero.xyz/i/2025/07/31/688b0806ccd78.png)

</details>

## 💡 计划中

- 自建数据源
- 大屏幕UI支持

## 🌏 国际化

Vnite 的国际化工作托管在 [Weblate](https://hosted.weblate.org/projects/vnite/) 上，欢迎参与。

<a href="https://hosted.weblate.org/engage/vnite/">
<img src="https://hosted.weblate.org/widget/vnite/multi-auto.svg" alt="translation-status" />
</a>

## ☎️ 联系我

- [Twitter](https://x.com/ximu3_)
- [Telegram 群组](https://t.me/+d65-R_xRx1JlYWZh)

## ⭐ 致谢

- [VNDB API](https://api.vndb.org/kana)
- [Steam API](https://partner.steamgames.com/doc/api)
- [YMGal API](https://www.ymgal.games/developer)
- ……
