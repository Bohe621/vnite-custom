import { net } from 'electron'
import * as cheerio from 'cheerio'
import { GameList, GameMetadata } from '@appTypes/utils'
import { getLanguage, getTagLanguage } from '~/features/system/services/i18n'
import { extractReleaseDateWithLibrary } from './i18n'
import { ConfigDBManager } from '~/core/database'
import i18next from 'i18next'

const ID_REGEX = /(rj|re|vj)\d{4,}/gi

/**
 * 从标签链接里取「跨语言稳定」的 id。标签文本随 `?locale=` 变（中「主从/主仆」、日「主従」），
 * 但同一标签的 href 两语言下**逐字相同**，所以 href 才是可用的归并键。三类形态：
 * 分类 `/genre/288/…` → `genre:288`；作品形式 `…/work_type/RPG/…` → `type:RPG`；
 * 作品特征 `…/options/SND/…` → `option:SND`。
 *
 * ⚠️ 别把 `work_category[0]/doujin` 带上：同人区是 `doujin`、pro 区是 `pc`，带上会让同一
 * genre 在两区裂成两个 id，所以只取末端真正判别的那一段。
 */
function dlsiteTagIdFromHref(href?: string): string | undefined {
  if (!href) return undefined
  const genre = href.match(/\/genre\/(\d+)/)
  if (genre) return `genre:${genre[1]}`
  const workType = href.match(/work_type\/([A-Za-z0-9_]+)/)
  if (workType) return `type:${workType[1]}`
  const option = href.match(/options\/([A-Za-z0-9_]+)/)
  if (option) return `option:${option[1]}`
  return undefined
}

function buildDlsiteWorkUrl(dlsiteId: string, language?: string): string {
  const localePart = language ? `?locale=${language}` : ''
  if (dlsiteId.startsWith('VJ')) {
    return `https://www.dlsite.com/pro/work/=/product_id/${dlsiteId}.html${localePart}`
  }
  return `https://www.dlsite.com/maniax/work/=/product_id/${dlsiteId}.html${localePart}`
}

/**
 * Vnite 界面语言 → DLsite 站的 locale。
 *
 * DLsite 只提供 **ja / en / zh-CN / zh-TW / ko / fr / it / de / es** 九种界面；
 * 其它语言代码传过去它不会报错，而是**自己回退到日文站**（实测 `?locale=ru` 与 `?locale=uk`
 * 回来的都是 `<html lang="ja-JP">` + 日文表头）。
 * 所以这里显式映射过去 —— 请求的 locale、表头文案、以及这份文本要登记成哪个语言，
 * 三者必须是同一套，否则「用 ru 的表头去匹配日文页面」永远匹配不上。
 */
const DLSITE_LOCALE_MAP: Record<string, string> = {
  ru: 'ja',
  uk: 'ja',
  // 系统语言可能带地区后缀（app.getLocale() 会给 fr-FR 这种），DLsite 只认主语言
  'fr-FR': 'fr',
  'it-IT': 'it',
  'de-DE': 'de',
  'es-ES': 'es'
}

export function dlsiteLocale(language: string): string {
  return DLSITE_LOCALE_MAP[language] ?? language
}

/**
 * 取某个 DLsite locale 下「某个表头」的文案。
 *
 * ⚠️ 这些文案是**用来在页面里按文本匹配 `th` 的**（`thText.includes(term)`），
 * 所以必须与该语言站点的真实表头逐字一致 —— 表头随站点改版会变，改版后这里就静默失效。
 * 实测（2026-09-24）：`ko` 站是 `작품 형식 / 판매일 / 시리즈명 / 서클명`，
 * 而之前写的是 `제품 형식 / 발매 일자 / 시리즈 이름 / 브랜드`（中文口气的直译）。
 *
 * 空串是**最糟**的情况：`includes('')` 恒为 true，每个 `th` 都命中、值被最后一个 td 反复覆盖。
 * 所以这里对「空 / 没有这条翻译」一律退回英文，英文也没有（不该发生）才返回空串，
 * 调用方拿到空串时必须跳过匹配。
 */
function headerTerm(key: 'workType' | 'releaseDate' | 'series', locale: string): string {
  const read = (lng: string): string => {
    const value = i18next.t(`scraper:dlsite.${key}`, { lng })
    if (typeof value !== 'string') return ''
    const text = value.trim()
    // i18next 查不到时会把 key 原样返回（`dlsite.workType`）
    return !text || text === `dlsite.${key}` ? '' : text
  }
  return read(locale) || read('en')
}

export async function searchDlsiteGames(gameName: string, gamePath?: string): Promise<GameList> {
  const findIdInName = await ConfigDBManager.getConfigValue('game.scraper.dlsite.findIdInName')
  if (findIdInName) {
    // Check if the game name contains a id pattern like "RJ123456"
    const matchSource = typeof gamePath !== 'undefined' && gamePath ? gamePath : gameName
    const matchIds = [...matchSource.matchAll(ID_REGEX)]
    // Return the first sucessfully fetched result
    for (let i = 0; i < matchIds.length; i++) {
      const dlsiteId = matchIds[i][0].toUpperCase()
      try {
        const gameMetadata = await getDlsiteMetadata(dlsiteId)
        if (gameMetadata.name && gameMetadata.name.length > 0) {
          const result: GameList = [
            {
              id: dlsiteId,
              name: gameMetadata.name,
              releaseDate: gameMetadata.releaseDate,
              developers: gameMetadata.developers
            }
          ]
          return result
        }
      } catch (error) {
        console.info(`Error fetching metadata for extracted ID ${dlsiteId}:`, error)
      }
    }
  }
  const encodedQuery = encodeURIComponent(gameName.trim()).replace(/%20/g, '+')
  const language = await getLanguage()
  const url = `https://www.dlsite.com/maniax/fsr/=/language/jp/keyword/${encodedQuery}/?locale=${language}`

  const response = await net.fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
      Cookie: `adultchecked=1; locale=${language}`
    }
  })

  const data = await response.text()
  const $ = cheerio.load(data)
  const results: GameList = []

  $('.search_result_img_box_inner').each((_, element) => {
    // Get ID from data-list_item_product_id attribute
    let id = $(element).attr('data-list_item_product_id') || ''

    // If ID is not found, try to extract it from the link URL
    if (!id) {
      const href = $(element).find('a.work_thumb_inner').attr('href') || ''
      const productIdMatch = href.match(/product_id\/([^.]+)\.html/)
      id = productIdMatch ? productIdMatch[1] : ''
    }

    // Get game name
    const nameElement = $(element).find('.work_name a')
    const name = nameElement.attr('title') || nameElement.text().trim()

    // Get developer
    const developer = $(element).find('.maker_name a').text().trim()
    const developers = developer ? [developer] : []

    if (name && id) {
      results.push({
        id,
        name,
        releaseDate: '',
        developers
      })
    }
  })

  console.log(`Search for "${gameName}" found ${results.length} results`)
  return results
}

export async function getDlsiteMetadata(dlsiteId: string): Promise<GameMetadata> {
  // Try to access the work page
  // `language` 是界面语言（`general.language`，如 `zh-CN`），`locale` 是**真正发给 DLsite 的**
  // 站点语言 —— 两者在 ru / uk 下不同（见 `DLSITE_LOCALE_MAP`）。
  const language = await getLanguage()
  const locale = dlsiteLocale(language)
  const url = buildDlsiteWorkUrl(dlsiteId, locale)

  // 表头文案取自 `locale` 的语言包，而那个包**不一定已加载**：语言包是按需拉取的，
  // 未加载时 `i18next.t(key, { lng })` 只会返回兜底语言（en）的值 —— 于是 ru 界面下
  // 拿英文表头去匹配日文页面，什么都匹配不到（实测踩过）。所以先把它加载好。
  await i18next.loadLanguages(locale)

  const response = await net.fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
      Cookie: `adultchecked=1; locale=${locale}`
    }
  })

  const data = await response.text()
  const $ = cheerio.load(data)

  // Extract basic information using Cheerio
  const name = $('#work_name').text().trim()
  const originalName = name

  const workTypeTerm = headerTerm('workType', locale)
  const releaseDateTerm = headerTerm('releaseDate', locale)
  const seriesTerm = headerTerm('series', locale)

  // Extract description, keep HTML but modify links to add target="_blank"
  const descriptionElement = $('[itemprop="description"]')

  // Find all links in the description element and add target="_blank" attribute
  descriptionElement.find('a').attr('target', '_blank')

  // Fix image and link URLs in the description, ensure URLs starting with // are converted to https://
  descriptionElement.find('img, a').each((_, element) => {
    const el = $(element)
    // Process img src attribute
    if (el.is('img')) {
      const src = el.attr('src')
      if (src && src.startsWith('//')) {
        el.attr('src', `https:${src}`)
      }
    }

    // Process link href attribute
    if (el.is('a')) {
      const href = el.attr('href')
      if (href && href.startsWith('//')) {
        el.attr('href', `https:${href}`)
      }
    }
  })

  // Remove all color styles
  descriptionElement.find('*').each((_, element) => {
    const el = $(element)
    // Remove color settings from style attribute
    const style = el.attr('style')
    if (style) {
      const newStyle = style
        .replace(/color\s*:\s*[^;]+;?/gi, '') // Remove color: xxx;
        .replace(/background-color\s*:\s*[^;]+;?/gi, '') // Remove background-color: xxx;
        .trim()

      if (newStyle) {
        el.attr('style', newStyle)
      } else {
        el.removeAttr('style')
      }
    }

    // Remove font color attribute
    el.removeAttr('color')
  })

  // Get the modified HTML
  let description = descriptionElement.html() || ''

  // Clean script and style tags
  description = description
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .trim()

  // Clear color attributes from font tags
  description = description
    .replace(/<font\s+color="[^"]*"([^>]*)>/gi, '<font$1>') // Remove <font color="xxx">
    .replace(/<font\s+color='[^']*'([^>]*)>/gi, '<font$1>') // Remove <font color='xxx'>
    .replace(/<span\s+style="color:\s*[^;"]*;?([^"]*)">/gi, '<span style="$1">') // Remove style="color: xxx;" but keep other styles
    .replace(/<span\s+style="background-color:\s*[^;"]*;?([^"]*)">/gi, '<span style="$1">') // Remove style="background-color: xxx;"
    .replace(/<span\s+style="([^"]*);?\s*color:\s*[^;"]*;?([^"]*)">/gi, '<span style="$1;$2">') // For cases when color is in the middle of style

  // Clean empty style attributes
  description = description.replace(/\sstyle="\s*"/gi, '').replace(/\sstyle='\s*'/gi, '')

  // Clean empty font tags, convert to span
  description = description
    .replace(/<font\s*>([^<]*)<\/font>/gi, '$1')
    .replace(/<font\s*([^>]*)>([^<]*)<\/font>/gi, '<span $1>$2</span>')

  // Clean whitespace between tags and consecutive whitespace
  description = description.replace(/>\s+</g, '><') // Clean whitespace between tags
  description = description.replace(/(\s)\s+/g, '$1') // Replace consecutive whitespace with a single space

  // Handle remaining URLs starting with // in the description (for possible inline styles or other attributes)
  description = description.replace(/(src|href)="\/\//g, '$1="https://')

  // Extract release date
  let releaseDate = ''
  $('th').each((_, element) => {
    const thText = $(element).text().trim()
    if (releaseDateTerm && thText.includes(releaseDateTerm)) {
      const releaseDateText = $(element).next('td').text().trim()
      // 用**映射后的 locale** 解析：ru 站返回的是日文页面，日期也是日文格式
      releaseDate = extractReleaseDateWithLibrary(releaseDateText, locale)
    }
  })

  // Extract developer (producer)
  const developer = $('.maker_name a').text().trim()
  const developers = developer ? [developer] : []
  const publishers = developers.length > 0 ? [...developers] : undefined

  // Extract tags and genres
  const tags: string[] = []
  const genres: string[] = []
  // 标签链接里的稳定 id（跨语言不变），交给词库归并不同语言的写法
  const tagIdList: { raw: string; id: string }[] = []
  const pushTag = (text: string, href?: string): void => {
    if (!text || tags.includes(text)) return
    tags.push(text)
    const id = dlsiteTagIdFromHref(href)
    if (id) tagIdList.push({ raw: text, id })
  }

  // Extract main genre tags
  $('.main_genre a').each((_, element) => {
    pushTag($(element).text().trim(), $(element).attr('href'))
  })

  // Extract work type
  $('th').each((_, element) => {
    const thText = $(element).text().trim()
    if (workTypeTerm && thText.includes(workTypeTerm)) {
      $(element)
        .next('td')
        .find('a')
        .each((_, genreElement) => {
          const el = $(genreElement)
          const genre = el.text().trim()
          if (genre && !genres.includes(genre)) {
            genres.push(genre)
            pushTag(genre, el.attr('href'))
          }
        })
    }
  })

  // Extract related sites
  const relatedSites: { label: string; url: string }[] = []

  relatedSites.push({
    label: 'DLsite',
    url
  })

  // Add producer site
  const makerUrl = $('.maker_name a').attr('href')
  if (makerUrl && developer) {
    relatedSites.push({
      label: `${developer} (${i18next.t('scraper:dlsite.maker', { lng: locale })})`,
      url: makerUrl.startsWith('//') ? `https:${makerUrl}` : makerUrl
    })
  }

  // Add series link (if exists)
  $('th').each((_, element) => {
    const thText = $(element).text().trim()
    if (seriesTerm && thText.includes(seriesTerm)) {
      const seriesElement = $(element).next('td').find('a').first()
      const seriesUrl = seriesElement.attr('href')
      const seriesName = seriesElement.text().trim()
      if (seriesUrl && seriesName) {
        relatedSites.push({
          label: `${seriesName} (${i18next.t('scraper:dlsite.series', { lng: language })})`,
          url: seriesUrl?.startsWith('//') ? `https:${seriesUrl}` : seriesUrl
        })
      }
    }
  })

  return {
    name,
    originalName,
    releaseDate,
    description,
    developers,
    publishers,
    genres: genres.length > 0 ? genres : undefined,
    relatedSites,
    tags,
    tagsDetail: {
      // ⚠️ DLsite 的标签文本是**服务器按 ?locale= 渲染**的，中文界面拿到的就是中文，
      // 所以这里必须报「本次请求用的语言」，不能让词库按 provider 名推断成日文
      // （否则中文标签会被登记成 names.ja）。
      // —— 取的是**映射后的 locale** 对应的词库语言：ru / uk 会被 DLsite 渲染成日文，
      // 那时应该登记成 names.ja，而不是跟着界面语言写成 names.ru。
      language: getTagLanguage(locale),
      ids: tagIdList.length > 0 ? tagIdList : undefined
    }
  }
}

export async function getDlsiteMetadataByName(gameName: string): Promise<GameMetadata> {
  try {
    const gameList = await searchDlsiteGames(gameName)

    if (gameList.length === 0) {
      return {
        name: gameName,
        originalName: gameName,
        releaseDate: '',
        description: '',
        developers: [],
        relatedSites: [],
        tags: []
      }
    }

    // Use the first match
    const firstMatch = gameList[0]
    return getDlsiteMetadata(firstMatch.id)
  } catch (error) {
    console.error(`Error fetching metadata for game ${gameName}:`, error)
    throw error
  }
}

export async function getGameBackgrounds(dlsiteId: string): Promise<string[]> {
  try {
    const url = buildDlsiteWorkUrl(dlsiteId)
    const language = await getLanguage()

    const response = await net.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
        Cookie: `adultchecked=1; locale=${language}`
      }
    })

    const data = await response.text()
    const $ = cheerio.load(data)
    const screenshots: string[] = []

    $('[data-src]').each((_, element) => {
      let imgUrl = $(element).attr('data-src') || ''

      if (imgUrl && imgUrl.startsWith('//')) {
        imgUrl = `https:${imgUrl}`
      }

      if (
        imgUrl &&
        !screenshots.includes(imgUrl) &&
        (imgUrl.includes('_img_main') || imgUrl.includes('_img_smp'))
      ) {
        screenshots.push(imgUrl)
      }
    })

    return screenshots
  } catch (error) {
    console.error(`Error fetching game backgrounds for work ${dlsiteId}:`, error)
    return []
  }
}

export async function getGameBackgroundsByName(gameName: string): Promise<string[]> {
  try {
    // First search to get ID
    const gameList = await searchDlsiteGames(gameName)

    if (gameList.length === 0) {
      return []
    }

    // Use the first match
    const firstMatch = gameList[0]
    return getGameBackgrounds(firstMatch.id)
  } catch (error) {
    console.error(`Error fetching game backgrounds for game ${gameName}:`, error)
    return []
  }
}

export async function getGameCover(dlsiteId: string): Promise<string> {
  try {
    const url = buildDlsiteWorkUrl(dlsiteId)
    const language = await getLanguage()

    const response = await net.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
        Cookie: `adultchecked=1; locale=${language}`
      }
    })

    const data = await response.text()
    const $ = cheerio.load(data)

    // First try to find an image containing img_main
    let mainImg = ''

    // Search for all image elements
    $('img[srcset], source[srcset]').each((_, element) => {
      const srcset = $(element).attr('srcset') || ''
      if (srcset.includes('img_main') && !mainImg) {
        mainImg = srcset
      }
    })

    // If an image containing img_main was found
    if (mainImg) {
      // Fix protocol-relative URL
      if (mainImg.startsWith('//')) {
        return `https:${mainImg}`
      }
      return mainImg
    }

    // If no image containing img_main was found, get the list of background images
    const screenshots = await getGameBackgrounds(dlsiteId)

    // Use the first background image as cover
    if (screenshots.length > 0) {
      return screenshots[0]
    }

    return ''
  } catch (error) {
    console.error(`Error fetching cover image for work ${dlsiteId}:`, error)
    return ''
  }
}

export async function getGameCoverByName(gameName: string): Promise<string> {
  try {
    // First search to get ID
    const gameList = await searchDlsiteGames(gameName)

    if (gameList.length === 0) {
      return ''
    }

    // Use the first match
    const firstMatch = gameList[0]
    return getGameCover(firstMatch.id)
  } catch (error) {
    console.error(`Error fetching cover image for work ${gameName}:`, error)
    return ''
  }
}

export async function checkGameExists(dlsiteId: string): Promise<boolean> {
  try {
    const url = buildDlsiteWorkUrl(dlsiteId)

    const response = await net.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
        Cookie: `adultchecked=1; locale=ja`
      }
    })

    // If the page loads successfully and doesn't contain error messages, the work is considered to exist
    const data = await response.text()
    return (
      response.ok &&
      !data.includes('該当作品はございません') &&
      !data.includes('作品は存在しません')
    )
  } catch (_error) {
    // Request failed, possibly with a 404 or other error
    return false
  }
}
