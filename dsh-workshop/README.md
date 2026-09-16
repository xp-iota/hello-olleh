# DSH 与 iota 实操课（12 集）

十二集，每集一个能自己跑完的任务，对应 `dsh-example` / `iota-example` 的 M01–M12。
每集独立交付：一份旁白内嵌的 MP4、一份可编辑 PPTX、逐页讲稿与真实命令证据。

## 旁白音色建议（Edge TTS）

以下建议来自当前已安装 Edge TTS runtime 的在线音色清单；`zh-CN-XiaoxiaoNeural` 已在 Ubuntu 上实际合成并通过 24 kHz、单声道 WAV 的可听度验证：

| 用途 | 推荐音色 |
| --- | --- |
| 主旁白 | `zh-CN-XiaoxiaoNeural` |
| 第二女声 | `zh-CN-XiaoyiNeural` |
| 男声 1 | `zh-CN-YunxiNeural` |
| 男声 2 | `zh-CN-YunjianNeural` |
| 另一女声 | `zh-CN-YunxiaNeural` |
| 新闻／播报备选 | `zh-CN-YunyangNeural` |
| 粤语角色 | `zh-HK-WanLungNeural` / `zh-HK-HiuMaanNeural` |
| 台湾普通话 | `zh-TW-YunJheNeural` / `zh-TW-HsiaoYuNeural` |

每一集只能通过该集所选的 **全局 TTS profile** 选择一个固定音色；不要在单个 slide 中写入 voice 覆盖。需要换声时，复制并修改调用方自己的 Edge TTS profile，再在该集生成命令中通过 `--profile` 显式选择。

## 12 集清单

| 集 | 模块 | 任务 | 运行命令 |
|---|---|---|---|
| 1 | M01 工具管线 | 加一个工具，让真实模型自己决定调用它 | `npm run M01` |
| 2 | M02 上下文装配 | 让上下文不再是一根越来越长的字符串 | `npm run M02` |
| 3 | M03 推理服务接入 | 换成 MiniMax，上层消费循环一行不改 | `npm run M03` |
| 4 | M04 循环干预 | 不复制主循环，也能在边界上引导一步 | `npm run M04` |
| 5 | M05 会话面 | 把「发生过的事」和「模型看见的事」分开 | `npm run M05` |
| 6 | M06 人在环路 | 危险操作先回到人，没人应答就必须拒绝 | `npm run M06` |
| 7 | M07 执行侧后端 | 工具只提意图，沙箱在进程边界上落策略 | `npm run M07` |
| 8 | M08 委派与预设 | 注册能力之外，再给模型一个看得见的入口 | `npm run M08` |
| 9 | M09 长任务编排 | 拆开「还在跑吗」与「要干成什么」 | `npm run M09` |
| 10 | M10 外部能力 | 把做法写成清单，对照注入前后的真实作答 | `npm run M10` |
| 11 | M11 配置与数据 | 命名空间、格式声明、版本号，凭证只看状态 | `npm run M11` |
| 12 | M12 框架机制 | 五种派发怎么选，副作用怎么随插件回收 | `npm run M12` |

每集同时给出 iota 侧的对照命令（`python -m runtime.runner MXX --real`），
所以同一个任务能看到两层的做法与各自的边界。

## 每集交付

- 一份旁白内嵌的 MP4：`e01.mp4` … `e12.mp4`；
- 一份可编辑 PPTX：`e01.pptx` … `e12.pptx`；
- 逐页讲稿：每集 `presentation.json` 的 `narration` 字段，视频旁白即由它合成；
- 真实命令证据：每集 `evidence/` 下脱敏后的运行日志。

## 内容结构与生成

- 每集七页：任务、真实输出、运行外壳、编排层、错误定位、代码在哪、动手练习；
  页数与页面类型由 [course.json](course.json) 的 `pagePlan` 定义，设计细则见 [AGENTS.md](AGENTS.md)。
- 本目录持有内容与外观：[course.json](course.json)（品牌、语言、画布、12 集清单）、
  [profiles/](profiles/)（调色板、字体栈、语音参数）、`00-brief/` 与 `topics/<id>/presentation.json`。
- 演讲稿与视频由 lusine-a-reves 渲染（仓库 `git@github.com:feuyeux/lusine-a-reves.git`，
  默认检出 `~/coding/lusine-a-reves`，可用 `LUSINE_ROOT` 覆盖）。

### 三条命令

全平台相同，不需要按操作系统改写：

```bash
uv sync
uv run workshop doctor                      # 自检工具链、渲染器与字体栈
uv run workshop scaffold --episode e01      # 按 course.json 生成骨架（或 --all）
uv run workshop build --episode e01         # 旁白 → manifest → 校验 → PPTX → MP4
```

交付物落在 `out/e01/e01.pptx` 与 `out/e01/e01.mp4`。换主题只改 `course.json`、`profiles/`、
`00-brief/` 与 `topics/`；换操作系统只可能改环境变量，生成行为不变。
完整路径分类、分步命令、内容纪律与验收见 [AGENTS.md](AGENTS.md)。
迁移背景、跨 OS/换主题原则、媒体质量与清理边界见 [MAINTENANCE.md](MAINTENANCE.md)。
