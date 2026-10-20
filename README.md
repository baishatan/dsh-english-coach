# 英语教练 · English Coach

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **English Coach** is a plugin for DeepSeek Harness (desktop) that prepares one English lesson a day, keeps a spaced-repetition queue, and gets out of your way. Materials are sourced from public pages, matched to your level, and saved as drafts until you start them. The interface is Chinese; English appears only in the learning material. No API key, local-first, MIT.

**英语教练**是装在 DeepSeek Harness 里的英语学习插件。界面是中文，英文只出现在学习材料里。它替你做每天那件二三十分钟的杂活——判断水平、找难度合适的材料、抠出值得记的表达、排复习——你只负责学。

- **每天一课，自动备好**：Agent 按你的画像和近期工作方向找公开素材，加工成阅读、听力、表达、测验（可选排序），先存成草稿；你点开始才算开始。
- **水平与路线**：一次约 10 分钟的 20 题自适应测评，给出六个中文档位之一、一句参照和薄弱项，并按档位生成一份不写死日期的大纲。
- **复习有排期**：单词和整块表达都进队列，间隔 1 / 7 / 30 / 90 天；在 1、7、30 天各答对一次才算「掌握」，答错退回第一盒。
- **碎片时间**：右下角一颗可拖动的药丸，显示待复习数，点开是下一个词，一键回到面板复习。
- **进步看得见**：已掌握数量、连续天数（允许跳一天不断签）、水平曲线、薄弱项。
- **想多学几个**：当天的词学完可以点「继续学习」，Agent 再补一批；每天学几个（默认 10，范围 3–30）在设置里改。

![今日视图](english-coach/docs/panel-today.png)

主面板是一张工作台：左边是当天要做的，右边常驻复习卡。

| 单词视图：词库 + 复习 | 词条详情 |
|:--:|:--:|
| <img src="english-coach/docs/panel-words.png" width="480" alt="单词视图"> | <img src="english-coach/docs/panel-word.png" width="480" alt="词条详情"> |

## 环境要求

- **DeepSeek Harness 桌面版**：插件用到宿主的插件槽位、持久化调度和本地文件写入，目前在该应用 `0.2.1-rc.2` 上验证过。
- **一个可用的模型连接**：首次出题、生成课程都要让模型跑一轮。
- **不需要 API key**，不需要在本机装 Node、pnpm 或任何依赖。
- 生成课程时需要联网：素材由 Agent 搜索并抓取公开网页。

## 安装

1. 克隆或下载本仓库，找到 `english-coach/` 目录。
2. 打开 DeepSeek Harness → 插件页 → **「本地安装」**，选择这个目录。
3. 侧边栏出现「英语教练」就装好了。装完不需要填任何配置。

> 插件管理器内部走的是 `plugin_manager` 的 `install_bundle`，目标写 `english-coach/` 的绝对路径。

更新：

```bash
git pull
```

然后在插件页重新加载插件。数据不受影响。

## 第一次用

1. 侧边栏点「英语教练」，填三件事：想用英语做什么、每天能挤出多久、目标档位。
2. 点「生成测评题库」，等一两分钟让 Agent 出一套题；再点「开始测评（20 题）」。
3. 做完看到六个中文档位之一、一句参照和薄弱环节，大纲会自动生成。

之后每天在「今日」点「生成今天」，或在设置里开启每日自动化让 Agent 到点备好草稿。想只更新水平、不重写大纲时，做一次短测（10 题）。

## 每天怎么用

| 时机 | 做什么 |
|---|---|
| 早上（若开启自动化） | 到点自动生成草稿，药丸提示「今日课程已就绪」 |
| 有空时 | 主面板「今日」→ 开始这一课 → 逐项完成；右栏随时把到期的词刷掉 |
| 碎片时间 | 点右下角药丸 → 「在面板里复习」，按 `1`–`4` 选、回车进下一张 |
| 想多学几个 | 当天的词学完点「继续学习」，Agent 再补一批，约一分钟 |
| 每周 | 「计划」看本周目标完成度；「进度」看水平曲线 |

## 数据与隐私

- **数据只在本机**。默认在 `~/DeepSeek-English/`，是普通的 JSON 和 Markdown，可以直接备份、拷走、用编辑器打开；设置页可以把目录改到别处（会先复制再切换）。
- **插件不收集遥测**，不上报学习数据，不内置任何统计或追踪。
- **生成走你自己的模型连接**。出题、生成课程时，Agent 会把提示词和素材交给你在 Harness 里配置的模型服务，并用平台的搜索/抓取能力取素材；插件本身不联系第三方服务器。
- **素材原文不缓存**。课程只保存原始链接、抓取时间与许可说明，阅读时回原文。
- **插件自己只额外写一个指针文件**：`~/.dsh/english-coach/root.json`，用来记住数据目录在哪。开启每日自动化时，会话与调度由 Harness 宿主创建和保存。
- **删干净**：移除插件不会动数据；想彻底清空，先备份再删 `~/DeepSeek-English/`。

完整的数据布局、工具接口和设计取舍见 [english-coach/README.md](english-coach/README.md)。

## 已知限制

- 口语与发音不做评分。
- 听力是浏览器内置语音合成，音色随系统；真人音频接口尚未实现。
- 不声称与任何外部考试分数等价。
- 每次生成课程、生成题库都要模型跑一整轮，有用量成本；自动化默认关闭，生成物先落草稿。
- 一次安装 = 一个学习者；不做多账号、社交、排行榜、跨设备同步。
- 只在 macOS 桌面版上实测过；Windows / Linux 尚未验证。
- 素材能不能抓到取决于网络与搜索源，抓不到时会换源，不会编造。

## 开发

```bash
cd english-coach
node --test test/core.test.js
```

插件分两半：`english-coach/index.js` 是 Host（工具、路由、调度、数据落盘），`client.js` 是 Client（主面板、悬浮层、设置页），`core/` 是一层纯 Node 的领域与状态模块。测试只打 `core`：给定一个临时数据目录和一条命令，断言返回结果与最终状态。

```
english-coach/
├── index.js        Host 半：五个 Agent 工具、Remote 路由、每日调度
├── client.js       Client 半：今日 / 单词 / 计划 / 进度、药丸、设置
├── core/           领域层：测评、复习、课程、锚题、存储
├── test/           34 项领域测试
├── docs/           截图与 ADR
├── locale/         界面文案
├── SPEC.md         要做什么，以及怎么判定做对了
├── DESIGN.md       为什么这样设计
├── GLOSSARY.md     术语表
└── NOTICE.md       来源与授权说明
```

## 文档

| 文件 | 内容 |
|---|---|
| [SPEC.md](english-coach/SPEC.md) | 需求、用户故事、实现决策、测试决策 |
| [DESIGN.md](english-coach/DESIGN.md) | 架构、数据模型、状态机与取舍理由 |
| [GLOSSARY.md](english-coach/GLOSSARY.md) | 领域术语 |
| [docs/adr/](english-coach/docs/adr/) | 架构决策记录 |
| [NOTICE.md](english-coach/NOTICE.md) | 锚题、素材、词表与图标的来源说明 |

## 参与

Issue 和 PR 都欢迎。改 `core/` 之前请先跑上面的测试；改界面请在真实插件里看一眼，而不只是看代码。

## 许可

[MIT](LICENSE)。锚题、图标与素材的处理方式见 [NOTICE.md](english-coach/NOTICE.md)。

英语教练与 DeepSeek 官方没有隶属关系，是第三方插件。
