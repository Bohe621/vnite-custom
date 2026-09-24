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
> **This repository is forked from [ximu3/vnite](https://github.com/ximu3/vnite) 4.13.0.**
> For my own needs, I added multi-language tags and multi-version games. Because the data structure was reworked, it is not compatible with old data; and since it owes a lot to AI with only a tiny bit of my own cleverness, I don't dare submit a PR. If you happen to have the same needs, feel free to give it a try — preferably if you haven't used it before, or if rebuilding your library isn't a hassle, since compatibility with old data can't be guaranteed. Last but not least, my sincere thanks to the authors of the original project for providing such a convenient tool.

Vnite is a versatile game management software designed to provide a unified interface for recording, managing, and synchronizing your gaming journey.

## ✨ Features

- Modern user interface (with customizable themes)
- Plugin support (with built-in plugin marketplace)
- Real-time cloud synchronization for all game records, saves, and settings across multiple devices
- Support for multiple data sources (Steam, IGDB, Bangumi, VNDB, YMGal, DLsite, Erogamescape)
- Supports automatic game library integration, each scanner can customize folder structure and data sources
- Flexible metadata transformer, supports regex modification, replacement, merging, and exclusion of any metadata
- Detailed reporting functionality, including annual, monthly, and weekly reports to review your gaming journey
- Integration with other programs (such as one-click LE region switching, automatic Magpie scaling, emulator launching, etc.)
- One-click import from Steam library (preserving game time)
- Multiple launch methods (files, links, scripts), with high customizability and preset configurations
- Dynamic categorization (by developer, tags, etc.)
- Powerful filters with support for custom metadata fields
- Session-based timer, supporting recording for individual files or folders
- Support for launching games via system links
- Complete separation of data and program for easy backup and customization

## 🍴  Fork Additions & Improvements

- **Multiple versions per game**: a game can hold several install copies (different versions), each with its own path, launch method and derived paths; launcher presets can also be applied per version.
- **Multi-language tag lexicon**: a user-editable registry of tag entities that automatically merges the same concept across data sources (by a source-stable id or a cross-language name index), supports multi-language display names, and offers management features such as merge, move and migrate. In plain terms: tags that share a meaning but come from different metadata sources are linked into a single tag, shown in the language you currently have selected. (VNDB tags are translated using some glossaries found online.)
- **Conflict management**: during a scan, if a new game can be matched to one already in the library but sits in a different directory (moved, re-downloaded or another version), it is recorded in the conflict manager for you to decide whether it is another version. Your decisions are logged, and games already handled are skipped on the next scan. Likewise, newly scraped tags are recorded there too, for you to decide whether to link them to another tag. This manager page exists to serve the two features above.
- **DLsite folder-name parsing**: improved recognition of the Chinese title and version information from a folder name, depending on your naming convention. For example, `[しなちくかすてぃーら][RJ269335] 夏色泡影 夏色のコワレモノ v1.05` is parsed into original title: 夏色のコワレモノ, translated title: 夏色泡影, version: v1.05.
- **NSFW enhancements**: a scan directory can be marked as NSFW, so every game added from it is flagged automatically; the top bar offers a one-click toggle for the default cover blur. (Trying to hide it only makes it more conspicuous, honestly...)
- **Wide-poster showcase layout**: supports switching to a wide (3:2) poster display, with optimized virtualized scrolling and image loading in portrait mode.

## Development

Use Node.js 20.19+ (20.x) or 22.12+, and the pnpm version pinned in `package.json`.
See the [pnpm installation guide](https://pnpm.io/installation) for setup.
Building the Windows native module also requires the Rust MSVC toolchain and Visual Studio C++ Build Tools with the Windows SDK.

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:native
pnpm dev
```

The application and `native` package share a workspace and the root `pnpm-lock.yaml`.
Use `pnpm typecheck` to check types, `pnpm build` to compile, and `pnpm build:win` to create the Windows installer.
`pnpm build` and `pnpm build:win` build the native module automatically.
Dependency patches in `patches/` are applied by pnpm during installation.

## 📸 Screenshots

<details>
<summary>Dark</summary>

![game](https://img.timero.xyz/i/2025/07/31/688b0cd59020b.png)

</details>

<details>
<summary>Light</summary>

![game](https://img.timero.xyz/i/2025/07/31/688b0d5d5511e.png)

</details>

## 💡 Planned Features

- Self-built data source
- Support for large-screen UI

## 🌏 Internationalization

The internationalization work of Vnite is hosted on [Weblate](https://hosted.weblate.org/projects/vnite/), and your participation is welcome.

<a href="https://hosted.weblate.org/engage/vnite/">
<img src="https://hosted.weblate.org/widget/vnite/multi-auto.svg" alt="translation-status" />
</a>

## ☎️ Contact Me

- [Twitter](https://x.com/ximu3_)
- [Telegram Group](https://t.me/+d65-R_xRx1JlYWZh)

## ⭐ Acknowledgements

- [VNDB API](https://api.vndb.org/kana)
- [Steam API](https://partner.steamgames.com/doc/api)
- [YMGal API](https://www.ymgal.games/developer)
- ...
