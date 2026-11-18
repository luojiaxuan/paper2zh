# 坑

- **Google 翻译免费接口会封 IP**：同一网络短时间翻几篇长论文，`translate.googleapis.com` 会对所有请求返回 302 跳到 `google.com/sorry`（验证码页），持续数小时，开发机和自己的浏览器一起被封。反复跑端到端测试时用带缓存的 profile（`E2E_PROFILE`）或大模型接口，别反复用 Google 模式跑整篇。`curl -X POST 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t' --data q=hi` 返回 302 即为被封。
- **扩展的端到端测试**：Playwright 自带的 headless shell 加载不了扩展，要 `npx playwright install chromium` 装完整版（约 380 MB，测完删）。activeTab 只有真实点击才授予，用 `--enable-unsafe-extension-debugging` 启动后经 CDP `Extensions.triggerAction`（目标是 `tab` 类型的 target）模拟点击，见 `scripts/e2e-extension.mjs`。没有 tabs 权限时 `chrome.tabs.query({ url })` 匹配不到任何标签页。
