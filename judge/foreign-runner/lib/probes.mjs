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

export function readPageState(page) {
  return page.evaluate(() => {
    return {
      url: window.location.href,
      hasCanvas: !!document.querySelector('canvas'),
      texts: Array.from(document.querySelectorAll('*')).map(e => e.textContent).filter(Boolean)
    };
  });
}
