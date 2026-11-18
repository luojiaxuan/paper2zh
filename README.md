<p align="center"><img src="app/icons/icon.svg" width="72" height="72" alt=""></p>

<h1 align="center">paper2zh</h1>

<p align="center">英文论文 PDF，一键变中文。图表、公式、版式原样保留，只替换正文；附 AI 速读总结。</p>

<p align="center"><a href="https://luojiaxuan.github.io/paper2zh/">在线使用</a> · <a href="https://github.com/luojiaxuan/paper2zh/releases/latest">下载 Chrome 扩展</a></p>

![左右对照](docs/images/dual.png)

## 能做什么

- **原位替换**：逐页识别正文、标题、图注，在原来的位置排入中文。图片、表格、公式、代码、参考文献保持原样，读起来还是那篇论文。
- **原文随时对照**：鼠标悬停任一段落看原文；可切换译文、左右对照、原文三种视图。
- **AI 速读**：一句话结论、问题、方法、关键数字、局限、最值得看的图表，几百字。
- **一键打开**：装上 Chrome 扩展后，在任意论文 PDF 页面（arXiv、OpenReview、会议官网）点工具栏图标即可。需要登录才能看的论文也行，扩展会用你在原站的登录状态取 PDF。
- **纯前端**：没有服务器。PDF 只在你的浏览器里解析，正文直接发给你选的翻译服务。翻译结果缓存在本机，重开同一篇不再花钱。

![AI 速读](docs/images/summary.png)

## 翻译服务

| 服务 | 需要 | 说明 |
|---|---|---|
| Google 翻译 | 无 | 默认，免费，可以先试试；没有 AI 总结 |
| Claude | Anthropic API Key | 默认 `claude-opus-5-5`，整篇想省钱可换 `claude-haiku-5-5` |
| DeepSeek | API Key | 中文好、便宜 |
| OpenAI / Gemini / OpenRouter | API Key | 填好 Key 后在设置里获取模型列表 |
| 其他 OpenAI 兼容接口 | 接口地址 | 例如本地 Ollama |

Key 只保存在你自己的浏览器（localStorage），请求从浏览器直接发往服务商。

## 安装扩展

1. 从 [Releases](https://github.com/luojiaxuan/paper2zh/releases/latest) 下载 `paper2zh-extension-*.zip` 并解压。
2. 打开 `chrome://extensions`，打开右上角“开发者模式”。
3. 点“加载已解压的扩展程序”，选择解压出的文件夹。

扩展安装时不要求“读取所有网站”的权限：只在你点击图标的那个标签页里取 PDF（activeTab）；少数取不到的情况，会先请你允许访问那一个网站。数据去向见[隐私说明](https://luojiaxuan.github.io/paper2zh/privacy.html)。本地 PDF 文件也想用扩展打开的话，在扩展详情里打开“允许访问文件网址”。不装扩展时，在[网页版](https://luojiaxuan.github.io/paper2zh/)拖入 PDF 或粘贴 arXiv 链接即可。

## 工作原理

1. 用 [pdf.js](https://github.com/mozilla/pdf.js) 取出每页文字的位置和字体，按行距、字号、缩进拼成段落；双栏、跨栏标题、行号、拉伸的两端对齐行都单独处理。
2. 嵌入的图片和 PDF 图形（`\includegraphics` 产生的 Form XObject）所占区域里的文字视为图内文字；成排对齐的短文本视为表格；等宽字体视为代码；参考文献标题之后、附录之前视为文献列表。这些都不翻译。
3. 每页的正文块一次性交给模型，返回逐块译文。模型把抽取时打碎的公式整理成 LaTeX，用 KaTeX 渲染。
4. 译文页由两次渲染合成：先正常渲染，再渲染一张跳过所有文字绘制指令的版本，把要替换的段落区域从后者拷贝过来，背景、线条、色块都不受影响；再把中文按原框大小自动调字号排上去。

## 开发

```bash
npm install
npm run vendor        # 把 pdf.js、KaTeX、Anthropic SDK 打包进 app/vendor
python3 -m http.server 8765 -d app
node scripts/dump-layout.mjs paper.pdf 1 3   # 打印版面分析结果
```

`app/` 同时是 GitHub Pages 的站点目录和 Chrome 扩展目录，没有构建步骤。

## License

MIT。第三方组件的许可证见 `app/vendor/`。
