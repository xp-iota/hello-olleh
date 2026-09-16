# dsh-workshop Agent 约束

《DSH 与 iota 实操课（12 集）》的内容工作区。两份文档分工：[README.md](README.md) 面向人，
说明课程本身；本文件面向代理，定义变量归属、每一步用什么命令、以及内容纪律。若有出入，以本文件为准。

## 0. 设计目标：换 OS、换主题都不改变生成行为

三类变量各有唯一归属，互不越界：

| 变量类型 | 唯一位置 | 换 OS 时 | 换主题时 |
|---|---|---|---|
| **内容** | [00-brief/](00-brief/) 意图 + `topics/<id>/presentation.json` 每集 deck | 不变 | 全换 |
| **外观** | [profiles/theme.course.json](profiles/theme.course.json) + [course.json](course.json) 的 `brand` / `locale` / `deck` | 不变 | 换预设 |
| **运行时** | 环境变量 + `workshop/runtime.py` | 只改这一层 | 不变 |

因此：**生成 PPTX 与 MP4 的行为只由 `course.json` 与 `topics/` 决定**，不由操作系统或当前目录决定。
`workshop/runtime.py` 是唯一允许感知主机的模块（可执行文件查找、版本门禁、字体可用性）。
禁止在任何其它文件写入绝对路径、驱动器号、`/opt/...` 兜底、平台分支或 shell 拼接。

## 1. 目录与变量归属

```text
dsh-workshop/
├── course.json               课程契约（唯一主题入口：品牌、语言、画布、页面计划、12 集清单）
├── profiles/
│   ├── theme.course.json     调色板与字体栈（外观唯一来源）
│   └── tts-profile.edge-tts.json  语音参数唯一来源
├── 00-brief/                 输入 · 课程意图（brief + answers，已确认）
├── content/course_content.py 输入 · 旧内容源，仅作撰写取材（其生成的旧 deck 为 schemaVersion 2）
├── topics/<id>/              每集主题目录，<id> 为小写 e01…e12
│   ├── presentation.json     输入 · 每集 deck（schemaVersion 1，入库）
│   ├── evidence/             输入 · 脱敏后真实命令日志（入库）
│   ├── public/images/        输入 · 手写配图，可选（入库）
│   ├── public/audio/         输出 · 旁白 WAV（不入库）
│   └── audio-manifest.json   输出 · 音频清单（不入库）
├── out/<id>/                 输出 · 交付物 <id>.pptx / <id>.mp4（不入库）
├── workshop/                 本工作区的 OS 中立编排入口（uv 管理）
├── pyproject.toml            workshop CLI 的包定义
├── README.md                 课程说明（面向人）
└── AGENTS.md                 本文件（面向代理）
```

生成物由本目录 [.gitignore](.gitignore) 忽略；交付物落在 `out/<id>/`，**不再写入渲染器仓库**。

渲染器本体在本仓库之外：`git@github.com:feuyeux/lusine-a-reves.git`，默认检出于
`~/coding/lusine-a-reves`，可用 `LUSINE_ROOT` 覆盖。其 `core/` 是可复用资产、`example/` 只是能力示例，
制作课程内容时都不得修改。

## 2. 生成步骤：一个入口，全平台同一条命令

一次性准备：

```bash
# 渲染器仓库（一次）
cd "$LUSINE_ROOT"            # 默认 ~/coding/lusine-a-reves
npm install && uv sync
npm run install:edge-tts     # 隔离的 Edge TTS runtime，固定 edge-tts==7.2.8

# 本工作区（一次）
cd dsh-workshop
uv sync
uv run workshop doctor       # 校验 node 版本下限、npm/uv/ffmpeg/ffprobe、edge runtime、字体栈
```

`doctor` 的 node 版本下限直接读取渲染器 `package.json` 的 `engines.node`，不在本仓库复制版本号。

| # | 步骤 | 命令 | 输入 → 输出 |
|---|---|---|---|
| 0 | 选题确认或变更 | `uv run lusine-meta intake --brief <abs> --answers <abs> --revise --yes`（在渲染器仓库执行） | brief → confirmed brief |
| 1 | 生成每集骨架 | `uv run workshop scaffold --episode e01`（或 `--all`） | course.json → deck 骨架 |
| 2 | 撰写内容 | 代理手写 `topics/<id>/presentation.json`，从 `content/course_content.py` 与 `evidence/` 取材 | 内容源 → deck |
| 3 | 构建交付物 | `uv run workshop build --episode e01`（或 `--all`） | deck → `out/<id>/<id>.pptx` + `.mp4` |

`workshop build` 内部按固定顺序调用渲染器，不重复实现任何生成逻辑：

1. `npm run voiceover:edge`（仅当该 deck 存在 `narration`；无旁白则跳过并生成无声视频）
2. `npm run manifest`
3. `npm run check`（始终带 `--brief`）
4. `npm run export:pptx`
5. `npm run render`

常用旗标：`--skip-pptx`、`--skip-mp4`、`--force-audio`。预览仍可在渲染器仓库执行
`npm run dev -- --presentation <abs> --manifest <abs> --public-dir <abs>`。

- deck 的 `id` 必须是小写字母、数字与连字符；渲染器据此命名输出文件，`scaffold` 已按 `e01…e12` 生成。
- 任何命令都可加 `--help`；渲染器对拼错的参数名直接报错并给出建议，不会静默回退。
- `npm run render` 在编码前会再次刷新 manifest 并校验，旁白时长自动决定每页视频长度。

## 3. Python 一律 uv

- 本工作区与渲染器的 Python 都只用 uv：`uv sync` 安装、`uv run <命令>` 运行；依赖变更时更新 `uv.lock`。
- 禁用 `pip install`、`python -m venv` 与 `requirements*.txt`。
- `.venv/`、`__pycache__/` 与 uv 缓存不入库。

## 4. 内容纪律

**选题**：brief 已确认，不得静默修改。变更（含追加 `--source` 资料）必须先 `--revise` 重新确认，
自动化确认加 `--yes`。brief 的 `voiceCharacter` / `voiceEmotion` / `voicePace` 只是意图记录，
不参与合成——实际音色由 `profiles/tts-profile.edge-tts.json` 固定；禁止在 slide 里写
voice、emotion、seed 或采样参数。

**Deck schema**：`schemaVersion: 1`；每页 `id` 唯一；`audio` 写相对该主题 `public/` 的路径
（Edge 路线固定 WAV，例 `audio/e01-task.wav`）；`eyebrow` 只写语义标签，页码由渲染器生成，不要手写。
字幕若存在：`endMs > startMs`、互不重叠；有音频时不得超过音频时长，无音频时不得超过该页 `minDurationSec`。

**页面结构**：每集页数与页面类型由 `course.json` 的 `pagePlan` 定义（当前 7 页），
课程设计含义如下；改结构改 `pagePlan`，不改代码。

| 页 | key | 作用 |
|---|---|---|
| 1 | `task` | 任务 + 可复制命令 + 预期结果（首帧即给齐，旁白前 10 秒念出命令与预期结果） |
| 2 | `terminal` | 该命令的真实终端输出，每一行都能在该集 `evidence/` 日志里找到 |
| 3 | `shell` | DSH 侧机制 |
| 4 | `orchestration` | iota 侧同一件事，以及它明确不做的部分 |
| 5 | `debug` | 真会遇到的症状 → 定位办法 → 修改 |
| 6 | `code` | 一条命令打开对应代码，并说明看哪几处 |
| 7 | `exercise` | 改哪里 + 验证命令 + 可验证答案，三件齐全 |

`pagePlan[].type` 只能取渲染器页面类型：`title` / `text` / `overview` / `metrics` / `diagram` /
`quote` / `closing` / `image`。旧管线的 `task` / `terminal` / `debug` / `code` / `exercise` 页类型
在新 schema 中不存在，迁移时按上表映射。每集时长目标 4–7 分钟，由旁白长度决定。

**事实与隐私**：内容引用的终端输出必须来自真实运行，不得手工编造，先脱敏再进入内容；
旁白（`narration`）是唯一会发给外部语音服务的文本，不得包含内部代码托管地址、内部包索引主机、
内部分支名、凭证、本机路径或个人信息，也不得包含建设过程、内部批次、文档制作术语与 AI 自述。

## 5. 验收

- 每集生成前必须通过 `workshop build` 内置的 `check`（始终带 `--brief`）；`render` 编码前会再次自动校验。
- 换机器或换 OS 后，先 `uv run workshop doctor`；字体栈若在本机无一可用，它会失败而不是静默回退。
- 改动渲染器工具链本身（而非课程内容）时，先在其仓库内通过 `npm run lint`、`npm test`、`uv run pytest`。
