/**
 * Probe reader: 从页面读取 window.__pfprobe 与 __exit_api_log 快照。
 */

export function readProbe(page) {
  return page.evaluate(() => {
    const p = window.__pfprobe;
    if (!p) return null;
    return {
      ready: p.ready ?? null,
      start: p.start ?? null,
      end: p.end ?? null,
      endWin: p.endWin ?? null,
      first: p.first ?? null,
      cta: p.cta ?? null,
      audio: { ...p.audio },
      media: { ...p.media },
      rtc: p.rtc ?? 0
    };
  });
}

export function readExitLog(page) {
  return page.evaluate(() => {
    return {
      log: window.__exit_api_log ? [...window.__exit_api_log] : [],
      hit_counts: { ...(window.__exit_api_hit_counts || {}) }
    };
  });
}

const MAX_TEXT_SAMPLE = 80;

export function readPageState(page) {
  return page.evaluate((maxLen) => {
    const all = Array.from(document.querySelectorAll('body *'));
    const texts = all.map(e => (e.textContent || '').trim());
    return {
      url: window.location.href,
      hasCanvas: !!document.querySelector('canvas'),
      // text_count = 全文有字的元素数（原始计数，不抽样）
      textCount: texts.filter(t => t.length > 0).length,
      // visible_texts = 短文本抽样：滤掉容器级 textContent（根/body 可达整篇正文，
      // 单条曾达 1.6MB，既撑爆产物又把语料正文整段带进流 JSON），
      // 去重后取前 10 条，每条 ≤ maxLen。
      texts: texts
        .filter(t => t.length > 0 && t.length <= maxLen)
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 10)
    };
  }, MAX_TEXT_SAMPLE);
}
