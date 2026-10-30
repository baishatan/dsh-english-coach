# 来源与授权说明

插件不预装考试机构题目或教材文本。主题词库分发 ECDICT 固定版本的词形、考试标签、中文释义子集，以及本项目加工的基础练习；适用来源许可随包提供。

## 锚题

`core/anchors.js` 里的 12 道锚题由本项目自行编写，用于观察"模型生成的测评题难度有没有随时间漂移"。它们不来自任何考试机构，也不是从受版权保护的文本改写的，不宣称与任何外部考试分数等价。冻结后只退役、不修改。

## 素材

学习者每天课程里的阅读与听力素材来自公开网页，由 Agent 在运行时检索并抓取。课程记录保存采纳的正文或文稿，以及原始链接、抓取时间、许可说明；不打包完整来源网站。素材的版权仍归原发布者，阅读时请回原文。

## 词表

ECDICT 来源为 [skywind3000/ECDICT 固定提交](<https://github.com/skywind3000/ECDICT/tree/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b>)，Copyright (c) 2025 Linwei，MIT 许可。原始许可见 [ECDICT-LICENSE.txt](<data/ECDICT-LICENSE.txt>)，来源、清洗、限制与改动说明见 [数据通知](<data/NOTICE.md>)，校验和及计数见 [数据清单](<data/manifest.json>)。

四级按 cet4，六级按 cet4 与 cet6 并集，雅思按 ielts 标签整理。均为开源学习参考，不是官方完整考试范围。中文释义具有多源背景，未逐条审计完整上游权利链；自动结构检查与非专业抽样不等于专业逐词审校。没有使用 CEFR-J 词表；六个中文档位为本项目显示映射，不作外部考试分数等价承诺。

## Kokoro 朗读资源（显式下载，不随插件捆绑）

固定下载清单见 [资源清单](<speech/asset-manifest.js>)：`onnx-community/Kokoro-82M-v1.0-ONNX`，revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`，q8 模型、词元配置，以及 `af_heart` / `am_michael` / `bf_emma` / `bm_george` 四声，共 94,453,730 字节。文件未经修改；每件资源均校验固定字节数与 SHA-256。来源及 Apache-2.0 声明见该 revision 的[上游模型卡](<https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/README.md>)，基础模型为 [hexgrad/Kokoro-82M](<https://huggingface.co/hexgrad/Kokoro-82M>)。

本插件的 MIT 许可不覆盖这些下载工件或后续独立分发的合成运行时。此处记录固定来源与上游声明，不替代全链路分发、参考声音权利及真实听感验收。资源准备功能不包含在线 G2P 导出或用户侧 Python 步骤；资源已校验与完整运行时可用分别报告。

## 图标

`icon.svg` 为本项目原创。
