# 内置主题词库：来源、加工与使用边界

这三套词库是开源整理的**学习参考**，不是考试机构指定全集，不构成考试分数或成绩保证。六级参考词库包含四级基础。目录总数与可练总数分开计数，详情见随包的 [数据清单](<manifest.json>)。

## 来源与许可

- 数据项目：[ECDICT — Free English to Chinese Dictionary Database](<https://github.com/skywind3000/ECDICT>)。
- 固定提交：[`bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`](<https://github.com/skywind3000/ECDICT/tree/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b>)。
- 原始文件：[ecdict.csv](<https://raw.githubusercontent.com/skywind3000/ECDICT/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/ecdict.csv>)，65,933,428 字节，770,611 条记录。
- 作者署名：Linwei（skywind3000）；Copyright (c) 2025 Linwei。
- 上游声明 MIT；随包保留完整 [ECDICT MIT 许可](<ECDICT-LICENSE.txt>)。[固定许可原文](<https://raw.githubusercontent.com/skywind3000/ECDICT/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE>)。
- CSV SHA-256：`1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`；Git blob SHA-1：`c4ade63ea08cf39d9c3475e96929036d64d94c94`。
- 上游中文释义有多源背景，未逐条审计完整权利链。项目 MIT 是采用依据，不是零版权风险或专业法律意见。

## 取舍与加工记录

数据版本 `ecdict-bc015ed2-conservative-v1`。构建验证整个固定 CSV 的字节数和 Git blob，再完整解析 CSV 引号、逗号、换行。只选用 word、translation、tag，并保留源记录序号用于追溯；不分发英文定义、音标、商业星级、词频字段、录音或完整大词典。

标签按空白拆分后**完整匹配**：四级取 `cet4`；六级取 `cet4 ∪ cet6`；雅思取 `ielts`。保留全部原始考试标签及所属参考词库。同词键仅折叠首尾/重复空白与大小写，不合并词形和英美拼写；相同键的源成员合并，不同释义保留并隔离。此版本选中 7,638 个词面，无规范化重复，不因练习质量门槛删掉目录成员。

发布 [静态数据](<wordlists.json>) 同时提供完整中文 `translation` 和练习 `meaning`。只规范转义换行、首尾空白，并移除开头的已知词性前缀；不凭空补译或改写为所谓原创释义。缺中文、特殊词形、排版污染、多义/多词性、语法用法说明、过短/过长释义均保留浏览并说明暂不可练原因。

预备题仅用于**基础词义识别**。通过保守单一干净义项门槛后，从 24 个具体概念的干扰项集合确定性选择三个；对完整源释义及英文别名筛除冲突，再排除共享汉字，以降低同义与近义重叠风险。已观察到的偏义、宽泛或不清晰释义有显式隔离记录。四个选项不同、正确项严格等于 `meaning`；没有通过门槛的词条不自动进入新词候选。

这种方式的代价是**可练覆盖率较低，干扰项较简单且会重复出现**；它不用于精细近义辨析或能力评级。自动筛查不是完整语义证明，源词典错误、未列出的同义词或不充分释义仍可能存在。非专业模型辅助检查和分层抽查**不是全词专业人工审校**。无论已加入与否，词库就绪状态都不覆盖个人释义、题目或学习进度。

目录使用规范化词面的固定字母序。学习顺序是按版本、词库标识和词面计算 SHA-256 后排序的固定打散序；不表示词频、难度或考试重要性。选项排序也使用固定 SHA-256，不依赖随机数、时间或系统语言环境。运行时读取随包内容，不下载词典或调用模型备题；每日课程和个性化补词仍可能使用模型，并非整个插件离线或零模型用量。

## 复现与校验

构建脚本 `scripts/build-wordlists.mjs` 接收完整原始 CSV 与原始 LICENSE 的本地路径，可指定输出目录；不自动联网，不新增依赖，使用 Node `>=24.21.0 <25`。维护者从上述固定链接获取输入后执行：

```sh
node scripts/build-wordlists.mjs --source /path/ecdict.csv --license /path/LICENSE --out /path/output
```

输出的 [数据清单](<manifest.json>) 包含源校验和、许可校验和、实际全量成员与就绪计数、共享词数、暂不可练原因计数及 JSON 产物大小/校验和。产物不包含构建时间或本机绝对路径，以便逐字节重建。运行时缺失、损坏或契约错误明确报错，不伪装为空库；来源与许可文件应和数据一起分发。
