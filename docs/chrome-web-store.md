# Chrome 应用商店上架材料

上架要在 [Chrome 开发者控制台](https://chrome.google.com/webstore/devconsole) 里由开发者本人操作；Chrome 禁止任何扩展操作商店页面，浏览器自动化（包括 Claude in Chrome）也点不了，只能手动。开发者账号是 `luojiaxuan1215@gmail.com`，控制台每次进入都可能要求通行密钥重新验证。下面是每个表单项要填的内容，图片在 `docs/store/`，用 `scripts/store-assets.mjs` 重新生成。

## 提交步骤

1. 注册开发者账号：一次性 5 美元注册费，开启 Google 账号的两步验证，验证联系邮箱。“交易者声明”按实际情况选，免费的个人项目一般选**非交易者**。
2. 新建项目，上传 [Releases](https://github.com/luojiaxuan/paper2zh/releases) 里最新的 `paper2zh-extension-v*.zip`（不用自己打包，打 tag 时 CI 生成）。
3. 按下面各节填写“商品详情”“隐私权”“分发”“测试说明”四个页面。
4. 提交审核。扩展安装时不要求访问任何网站（只用 activeTab），不会因为主机权限被转入深度审核。
5. 审核通过后，把商店链接加进 README 和网站首页的安装说明，开发者模式的安装方式保留给想用最新版的人。

以后发新版：改 `app/manifest.json` 的 `version`，打同名 tag（如 `v0.2.1`），从 Release 下载 zip，在控制台“软件包”页上传并提交。

## 商品详情

**名称与摘要**：来自 `manifest.json`，不在控制台填写。

- 名称：`paper2zh · 论文一键中文`
- 摘要：`在 arXiv、OpenReview 等论文 PDF 页面点一下，打开保留原版式的中文译本：图表公式不动，只换正文，附 AI 速读总结。`

**说明**（纯文本，直接粘贴）：

```text
paper2zh 把英文论文 PDF 变成中文版：图表、公式、版式原样不动，只把正文换成中文，旁边附一份 AI 速读总结。读论文时不用再逐字逐句啃英文。

怎么用
1. 在 arXiv、OpenReview、会议官网等网站打开论文 PDF。
2. 点浏览器工具栏上的 paper2zh 图标。
3. 中文版在新标签页打开。先翻你正在看的页，其余页在后台继续。
也可以在论文的 PDF 链接上点右键，选“用 paper2zh 打开这个 PDF”。

功能
· 原位替换：逐页识别正文、标题和图注，在原来的位置排入中文；图片、表格、公式、代码、参考文献保持原样。
· 原文随时对照：鼠标悬停任一段落即可看原文，也可以切换译文、左右对照、原文三种视图。
· AI 速读总结：一句话结论、要解决的问题、方法、关键数字、局限，以及最值得细看的图表。
· 公式不动：段落里的行内公式直接用原文的字形，不经过翻译；独立公式整块保留；粗体照原文加粗。
· 引用不打断阅读：引用缩成小号上标，括号保留，点开即看参考文献条目。
· 需要登录的论文也能用：扩展在你点击的标签页里，用你在该网站的登录状态下载 PDF。
· 译文缓存在本机，重开同一篇论文立即显示。

翻译服务
默认用免费的 Google 翻译，装好即可用（没有 AI 总结）。想要更好的译文和 AI 总结，在设置里填入自己的 API Key，可选 Claude（Anthropic）、DeepSeek、OpenAI、Gemini、OpenRouter，或任何 OpenAI 兼容接口（包括本地模型）。

隐私
没有服务器，也没有账号。PDF 在你的浏览器里解析，论文文字直接发给你选的翻译服务；API Key 和译文缓存只存在本机。扩展只在你点击图标时访问当前标签页，不读取浏览记录，不含统计和广告代码。
隐私说明：https://luojiaxuan.github.io/paper2zh/privacy.html
网页版与源码（MIT）：https://github.com/luojiaxuan/paper2zh

English
paper2zh turns English research paper PDFs into Chinese in place. Figures, tables, equations and layout stay as they are; only the body text is replaced, with a concise AI summary alongside. Click the toolbar button on a paper PDF (arXiv, OpenReview, conference sites) to open the Chinese version in a new tab. Free Google Translate works out of the box; for better translations and the summary, add your own key for Claude, DeepSeek, OpenAI, Gemini, OpenRouter or any OpenAI-compatible endpoint. Everything runs in your browser, with no server in between.
```

**类别**：教育（Education）。**语言**：中文（简体）。

**图片**（都在 `docs/store/`）：

| 控制台字段 | 文件 | 规格 |
|---|---|---|
| 商店图标 | `store-icon-128.png` | 128×128，图形 96×96 居中，透明边 |
| 屏幕截图（按顺序） | `screenshot-1-summary.jpg`、`screenshot-2-dual.jpg`、`screenshot-3-hover.jpg`、`screenshot-4-settings.jpg` | 1280×800，无透明通道 |
| 小型宣传图块 | `promo-small-440x280.jpg` | 440×280 |
| 顶部宣传图块（可选） | `promo-marquee-1400x560.jpg` | 1400×560 |

截图里的论文是 DPO（arXiv 2305.18290，CC BY 4.0），译文和总结来自真实运行的缓存。

**网址**：

- 首页网址：`https://luojiaxuan.github.io/paper2zh/`
- 支持网址：`https://github.com/luojiaxuan/paper2zh/issues`
- 官方网址留空（需要在 Search Console 验证域名所有权，github.io 子域名做不到）。

## 隐私权

**单一用途说明**：

```text
Translate the research paper PDF the user is viewing into Chinese while keeping its original layout, figures and equations, and generate a short summary of the paper.
```

**权限理由**：

activeTab

```text
When the user clicks the toolbar button (or the "Open this PDF with paper2zh" context menu item) on a tab showing a paper PDF, the extension downloads that PDF to translate it. activeTab limits access to the tab the user explicitly chose, at the moment they chose it.
```

scripting

```text
Some paper sites (for example OpenReview) serve the PDF only to requests made from their own pages with the user's session. After the user clicks the button, the extension runs one fetch of the PDF URL inside that tab with scripting.executeScript (under activeTab) and hands the bytes to the extension's viewer page. It injects no other code and never modifies the page.
```

contextMenus

```text
Adds a single menu item, "Open this PDF with paper2zh", on links, so a linked paper PDF can be opened in the viewer directly.
```

主机权限（optional_host_permissions）

```text
Optional, never requested at install. If downloading a PDF fails with activeTab alone (for example a PDF linked from a different site), the viewer shows an "Allow access to <site>" button; clicking it calls chrome.permissions.request for that single site, and the download is retried. Users can revoke it on the extensions page at any time.
```

**是否使用远程代码**：否。

```text
All JavaScript, WebAssembly (pdf.js) and fonts are included in the package. The extension sends text to translation APIs over HTTPS (Google Translate by default, or the LLM API the user configures) and receives only text/JSON back; no code is downloaded or evaluated.
```

**数据使用**：勾选下面两项，其余不勾。

- 网站内容：用户打开的论文 PDF 的文字，发给用户选择的翻译服务，用于翻译和总结。
- 身份验证信息：用户自己填写的第三方 API Key，只存在本机，只随请求发给对应的服务商。

然后勾选三项声明：不向第三方出售或转让用户数据（核准用途除外）；不将用户数据用于与单一用途无关的目的；不将用户数据用于判断信用或放贷。

**隐私权政策网址**：`https://luojiaxuan.github.io/paper2zh/privacy.html`

## 分发

公开；所有地区；免费。

## 测试说明

```text
No account or key is needed. Open https://arxiv.org/pdf/2305.18290 and click the paper2zh toolbar button. The paper opens in a new tab and is translated with the default free Google Translate; hovering a paragraph shows the original English. The "AI 总结" (AI summary) panel needs a user-provided LLM API key and can be skipped.
```
