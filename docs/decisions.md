# 决策日志

每条一行：问题、选择、理由、怎么撤回。时间为美国太平洋时间。

- 2026-11-17 PT · 形态：网站与 Chrome 扩展共用 `app/` 一套代码，扩展只多一个后台脚本。理由：GitHub Pages 跨域读不到 OpenReview 等站点的 PDF，扩展能带登录态取；网站负责展示、拖入文件和 arXiv 链接。撤回：删掉 `manifest.json` 和 `background.js` 即为纯网站。
- 2026-11-17 PT · 默认翻译服务用免费的 Google 翻译接口，大模型需自带 Key。理由：访客零配置就能试用；Claude 等需要用户自己的 Key，前端无法代付。撤回：改 `app/js/settings.js` 里 `DEFAULTS.provider`。
- 2026-11-17 PT · 译文页用“正常渲染 + 跳过文字指令的渲染”拼合来擦除原文，而不是盖白框。理由：色块背景、表格线、紧邻的图形不受影响。代价是每页多一次渲染。撤回：`viewer.js` 的 `compose` 改为填充背景色。
- 2026-11-17 PT · Claude 默认 `claude-opus-5-5`（翻译 effort low，总结 effort medium），并开启服务端拒答回退（`fallbacks: "default"`）。撤回：设置里改模型；`providers.js` 的 `fallbackParams`。
- 2026-11-17 PT · 仓库公开（用户要求用 GitHub Pages 发布并分享）。README 演示图用 CC BY 4.0 的 DPO 论文（arXiv 2305.18290），没有用测试时的那篇匿名在审论文。
