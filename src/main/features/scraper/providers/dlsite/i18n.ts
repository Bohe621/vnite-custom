import { parse, format } from 'date-fns'

/**
 * 把 DLsite 各站点的发售日文本解析成 `yyyy-MM-dd`。
 *
 * 实测各站的格式（同一作品 RJ126019，2026-09-24）：
 *
 * | 站点 | 文本 |
 * |---|---|
 * | ja / zh-CN / zh-TW | `2013年12月28日` |
 * | ko | `2013년 12월 28일` |
 * | en | `Dec/28/2013`（月在前） |
 * | fr / it | `28/12/2013`（日在前的 DMY） |
 *
 * 以前只认 `en` 与 `ja`/`zh-CN` 三种，所以 ko 站抓到了行也解析不出日期
 * （而且那一版 ko 表头文案本身就是错的，行都找不到）。
 * 现在四种格式都试一遍 —— 它们互不冲突，不必按语言分支，少一个语言就少一处漏解析。
 * `language` 只用于日志，不参与判断。
 */
export function extractReleaseDateWithLibrary(dateText: string, language: string): string {
  try {
    const text = (dateText || '').trim()
    if (!text) return ''

    // 中日：2013年12月28日
    const cjk = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
    // 韩：2013년 12월 28일
    const korean = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
    // 英文站：Dec/28/2013（月份在前）
    const english = text.match(/([A-Za-z]{3})\/(\d{1,2})\/(\d{4})/)
    // 其它（fr / it 等）：28/12/2013（日在前的 DMY）
    const dayFirst = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)

    let parsedDate: Date | null = null
    if (cjk) {
      parsedDate = new Date(Number(cjk[1]), Number(cjk[2]) - 1, Number(cjk[3]))
    } else if (korean) {
      parsedDate = new Date(Number(korean[1]), Number(korean[2]) - 1, Number(korean[3]))
    } else if (english) {
      parsedDate = parse(`${english[1]} ${english[2]} ${english[3]}`, 'MMM dd yyyy', new Date())
    } else if (dayFirst) {
      parsedDate = new Date(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]))
    }

    if (parsedDate && !isNaN(parsedDate.getTime())) {
      return format(parsedDate, 'yyyy-MM-dd')
    }

    if (text) console.warn(`[DLsite] Unparsed release date (${language}): "${text}"`)
    return ''
  } catch (error) {
    console.error('Date parsing error:', error)
    return ''
  }
}
