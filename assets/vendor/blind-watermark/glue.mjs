/*
 * blind-watermark-wasm 的浏览器适配层。
 *
 * 上游 dist/blind_watermark.js 是 emscripten 产出的 CJS/AMD 脚本（结尾用
 * module.exports 暴露工厂函数），不能直接当 ES module 用，所以这里在需要时
 * 用 <script> 动态加载一次，拿到挂到 globalThis 上的工厂函数。
 *
 * 上游 index.mjs 第 2 行原本是 `import ... from "./blind_watermark.js"`，
 * 项目里的 index.browser.mjs 把它改成了从本文件 import。
 */

export default async function loadBlindWatermarkFactory(moduleArg = {}) {
  if (globalThis.BlindWatermarkModule) {
    return globalThis.BlindWatermarkModule(moduleArg);
  }

  // Node（本地测试）环境：blind_watermark.js 是 CommonJS，动态 import 即可。
  if (typeof document === 'undefined') {
    const mod = await import('./blind_watermark.js');
    const factory = mod.default || mod;
    globalThis.BlindWatermarkModule = factory;
    return factory(moduleArg);
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./blind_watermark.js', import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error('WASM 模块加载失败，请刷新页面重试'));
    document.head.appendChild(script);
  });

  if (!globalThis.BlindWatermarkModule) {
    throw new Error('WASM 模块加载失败');
  }
  return globalThis.BlindWatermarkModule(moduleArg);
}
