# 第三方代码说明

## blind-watermark-wasm

- 版本：2.0.0
- 作者：JackCao
- 协议：MIT
- 上游：<https://github.com/JackCaow/blind-watermark-wasm>
- 本目录中的文件来自 npm 包 `blind-watermark-wasm@2.0.0` 的 `dist/`，未修改 `blind_watermark.js`（emscripten 产物）与 `index.mjs`。

本站在此基础上加了两处适配，使它能被浏览器直接当 ES module 用，而不需要打包工具：

- `glue.mjs`（新增）：浏览器里用 `<script>` 动态加载 `blind_watermark.js` 并取它的 UMD 工厂函数；Node 环境走 `import` 分支（仅为本地测试方便）。
- `index.browser.mjs`：上游 `index.mjs` 的副本，只把第 2 行的 `import ... from "./blind_watermark.js"` 改成 `from "./glue.mjs"`，其余逻辑未变。

MIT 许可证全文见上游仓库。

## 本站自己的部分

`/assets/wm.js`（页面逻辑，含文件队列、进度、ZIP 打包）与 `/assets/wm-core.js`（CRC32、STORE 模式 ZIP、容量估算）为本站原创，与上游无关。
