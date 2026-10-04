/**
 * vendor-copy from D:\new-workspace\pu-workbench\qacore\src\ev.ts (whole file)
 * source sha256: 44cfe4053b3a9ba4322aeae4f6e0f6a019213bced6e48cfe5b90c9f3942567b9
 * evaluate 适配：oracle（playwright-python）的 page.evaluate 接受 "函数源码字符串"。
 */
import { Page } from "playwright";

export function ev(page, functionSource) {
  const fn = new Function(`return (${functionSource})();`);
  return page.evaluate(fn);
}
