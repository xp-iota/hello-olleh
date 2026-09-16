# 构建与维护经验

本文记录本轮从旧课程产物迁移到“内容、外观、运行时分层”的经验，供后续换主题、换操作系统和批量生成媒体时复用。它解释为什么当前结构如此设计；操作约束仍以 [AGENTS.md](AGENTS.md) 为准。

## 1. 最重要的结论：先分变量，再谈自动化

生成行为稳定的前提不是“脚本兼容更多分支”，而是让三类变化各有唯一归属：

| 变化 | 唯一事实来源 | 不应出现的位置 |
|---|---|---|
| 课程内容 | `00-brief/`、`course.json`、`topics/<id>/presentation.json` | 运行时探测、平台分支 |
| 品牌、画布、主题、字体、音色 | `course.json`、`profiles/` | 渲染器源码、单页临时覆盖 |
| OS、工具位置、可执行文件 | `workshop/runtime.py`、环境变量 | deck、brief、theme profile |

由此得到两个可验证目标：

- **换主题**：只改描述符、profile 和 topic deck，不改编排代码。
- **换 OS**：只改变运行时解析结果；同一 deck 仍产生同规格 PPTX/MP4。

本轮已用临时 `course.json` 替换品牌、locale 和 episode 清单，未改代码即可生成新 deck；也已从仓库外目录通过 `WORKSHOP_ROOT` / `LUSINE_ROOT` 运行 `doctor`，证明路径不依赖当前目录。

## 2. 机器可读契约比散落文档可靠

旧流程把页数、画布、主题、命令和 episode 清单散落在 Python 常量、Markdown 和输出目录中，导致以下漂移：

- brief 写 40 页，而实际产品是 12 集 × 7 页；
- 文档写 Node 18，渲染器实际要求 Node 22.18；
- 旧 deck 使用 `task` / `terminal` / `debug` / `code` / `exercise`，渲染器只接受通用 slide type；
- 文档记录 MP3，实际稳定输出契约已改为 24 kHz 单声道 WAV。

当前做法：

1. `course.json` 定义 episode、`pagePlan`、画布、品牌、locale 和 profile 路径。
2. `workshop/course.py` 在任何生成开始前拒绝重复/非法 ID、未知 slide type、缺失 profile。
3. Node 版本下限从 Lusine 自己的 `package.json#engines.node` 读取，不再复制数字。
4. brief 的 `slideCount` 固定与 `episodes × pagePlan` 一致，并由测试守护。

经验：**凡是需要两处同步修改的数字，最终都会漂移；应改为一处数据、一处派生校验。**

## 3. PPTX 与 MP4 必须共享语义输入和质量门禁

PPTX 与 MP4 都消费同一份 `presentation.json`。不要为两种输出维护两套内容，也不要把 PPTX 截图当作唯一源文件。

课程构建和 lesson 媒体生成中形成的质量策略：

- PPTX 保持可编辑矢量元素；
- deck 的视频规格明确写入数据（课程 lesson 媒体采用 1920×1080@30fps）；
- 中间静帧使用 PNG，避免小字号文本经历 JPEG 代际损失；
- H.264 对静态课程画面采用高质量 CRF，并检查最终分辨率、帧率和音频流；
- 每次生成后验证 deck 页数、PPTX 页数、MP4 视频/音频流、WAV 格式和时长。

本轮 `dsh-example` 与 `iota-example` 共 26 课的验证结果证明了该模式：26 份 deck 与 PPTX 均为 7 页，26 个 MP4 均为 1920×1080@30fps H.264 + AAC，182 个 WAV 均为 PCM 16-bit、24 kHz、单声道。具体映射记录在各项目的 `lesson-media.json`。

## 4. 音色准确性靠 profile 和追踪，不靠记忆

音色必须是每课/每集的全局 profile，不允许 slide 级别临时覆盖。这样能回答“这条音频究竟由哪个声音生成”。

Edge TTS 的实战经验：

- 在线音色清单只证明服务端声明存在，不等于每次合成都成功；
- 连续快速请求会出现 `NoAudioReceived`，需要固定参数重试、指数/阶梯退避和成功后的节流；
- 失败时不可静默切换音色，否则产物与 manifest 不一致；
- 已完成 WAV 应先通过可听度和格式检查，然后断点续跑只补缺失段；
- Edge 返回 MP3，最终交付应显式转为 24 kHz、单声道、PCM 16-bit WAV，再生成 manifest。

本轮实际使用并追踪了 `Xiaoxiao`、`Xiaoyi`、`Yunxi`、`Yunjian`、`Yunxia`、`Yunyang` 六种普通话 Neural 音色。服务端限流期间仍保持原定音色，未做隐式 fallback。

## 5. 字体是跨 OS 视觉一致性的运行时依赖

只写 `PingFang SC` 会在 Linux 静默回退，只写 `Microsoft YaHei` 会在非 Windows 漂移。当前 profile 使用跨 OS 字体栈：

```text
Noto Sans CJK SC → Source Han Sans SC → PingFang SC → Microsoft YaHei → WenQuanYi Micro Hei → sans-serif
```

`workshop doctor` 会检查本机是否至少有一个具体中文字体；无字体查询工具时报告“未验证”，字体栈全部缺失时失败。经验：**不要把字体 fallback 当作成功；无法确认时必须显式报告。**

## 6. 长任务要可恢复，验证要分层

TTS 与视频编码都可能超过交互通道超时。可靠流程应满足：

- 每段音频落独立文件，成功后原子替换；
- manifest 用内容 hash 复用未变化音频；
- build 可重复执行，已通过的音频不重做；
- 先做 schema/profile/脚本契约测试，再做一课端到端样本，最后批量生成；
- 批量结束后做聚合验证，而不是把“命令启动成功”当作产物成功。

推荐验收顺序：

```bash
uv run workshop doctor
uv run pytest
uv run workshop scaffold --all
# 撰写并核实内容后：
uv run workshop build --episode e01
```

## 7. 清理边界

| 分类 | 例子 | 处理 |
|---|---|---|
| 源码/契约 | `course.json`、`profiles/`、`workshop/`、`tests/`、`topics/*/presentation.json` | 保留并入库 |
| 内容迁移来源 | `content/course_content.py` | 当前 topic 正文未迁移完前保留；完成后再显式删除 |
| 本地依赖 | `.venv/` | 可由 `uv sync` 重建；为保持立即可运行可保留 |
| 冒烟/交付输出 | `out/`、`topics/*/audio-manifest.json`、`topics/*/public/audio/` | 可再生成，默认不入库，可随时清理 |
| 缓存 | `.pytest_cache/`、`__pycache__/` | 始终可清理 |
| 旧第二管线 | 已删除的 `tools/` | 不恢复；若确需审计可从 Git 历史读取 |

不要清理兄弟项目 `dsh-example/dist/lessons/` 与 `iota-example/dist/lessons/`：它们是用户明确要求生成的 26 课交付物，虽被 Git 忽略，当前仍是有效产品产物。
