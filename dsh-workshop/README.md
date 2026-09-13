# DSH 与 iota 实操课（12 集）

十二集，每集一个能自己跑完的任务，对应 `dsh-example` / `iota-example` 的 M01–M12。
每集独立交付：一个 MP4、一份 PPT、一份讲稿、一份真实命令证据。

每集的第一张画面就给齐三件事，学员不用等：

1. **本集任务** —— 这一集要做完的那件事；
2. **可复制的运行命令** —— 暂停就能敲；
3. **将看到的结果** —— 拿它对照自己的输出。

## 12 集清单

| 集 | 模块 | 任务 | 运行命令 |
|---|---|---|---|
| 1 | M01 工具管线 | 加一个工具，让真实模型自己决定调用它 | `npm run M01:real` |
| 2 | M02 上下文装配 | 让上下文不再是一根越来越长的字符串 | `npm run M02` |
| 3 | M03 推理服务接入 | 换成 MiniMax，上层消费循环一行不改 | `npm run M03:real` |
| 4 | M04 循环干预 | 不复制主循环，也能在边界上引导一步 | `npm run M04:real` |
| 5 | M05 会话面 | 把「发生过的事」和「模型看见的事」分开 | `npm run M05:real` |
| 6 | M06 人在环路 | 危险操作先回到人，没人应答就必须拒绝 | `npm run M06:real` |
| 7 | M07 执行侧后端 | 工具只提意图，沙箱在进程边界上落策略 | `npm run M07:real` |
| 8 | M08 委派与预设 | 注册能力之外，再给模型一个看得见的入口 | `npm run M08:real` |
| 9 | M09 长任务编排 | 拆开「还在跑吗」与「要干成什么」 | `npm run M09:real` |
| 10 | M10 外部能力 | 把做法写成清单，对照注入前后的真实作答 | `npm run M10:real-demo` |
| 11 | M11 配置与数据 | 命名空间、格式声明、版本号，凭证只看状态 | `npm run M11:real` |
| 12 | M12 框架机制 | 五种派发怎么选，副作用怎么随插件回收 | `npm run M12:real` |

每集同时给出 iota 侧的对照命令（`python -m runtime.runner MXX --real`），
所以同一个任务能看到两层的做法与各自的边界。

## 每集的七页结构

| 页 | 类型 | 作用 |
|---|---|---|
| 1 | 任务 | 任务 + 可复制命令 + 预期结果（首帧即给齐） |
| 2 | 真实输出 | 该命令的真实终端输出（取自 `05-evidence/commands/`） |
| 3 | 运行外壳 | DSH 侧机制 |
| 4 | 编排层 | iota 侧同一件事，以及它明确不做的部分 |
| 5 | 错误定位 | 真会遇到的症状 → 定位办法 → 修改 |
| 6 | 代码在哪 | 一条命令打开对应代码，并说明看哪几处 |
| 7 | 动手练习 | 改哪里 + 验证命令 + 可验证答案 |

## 交付物

- `04-out/E01.mp4` … `E12.mp4`：12 集视频（1280×720、h264 + aac，每集 4–7 分钟）。
- `04-out/E01.pptx` … `E12.pptx`：12 份 PPT，每页备注含标题、旁白与该页命令。
- `01-scripts/E01.md` … `E12.md`：逐页讲稿（旁白、命令、真实输出节选、练习答案）。
- `02-decks/E01` … `E12`：每集的 `presentation.json` 与 `audio-manifest.json`。
- `03-public/E01` … `E12`：每集 7 段旁白 MP3 与 7 张画面。
- `05-evidence/commands/`：24 份真实运行日志（每集 DSH 与 iota 各一份，均已脱敏）。

## 重新生成

四步，顺序固定；后一步依赖前一步的产物。

```bash
# 1. 采集真实运行证据（会发起真实 MiniMax 请求）
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/capture_evidence.py

# 2. 生成 12 集 deck 与讲稿
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/build_content.py

# 3. 生成旁白音频（edge-tts，只发送 narration）
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/build_audio.py

# 4. 渲染画面、拼视频、打包 PPT
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/build_course.py
```

渲染时强制两条版式纪律：文字不得越界或压到页脚；画面不得与空背景无差别
（防止渲染失败却静默产出空白页）。单集重建加 `--only E03`。

## 验收

```bash
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/validate_workshop.py
```

验收器逐集检查：

- 12 集结构（decks / scripts / public / 视频 / PPT 各 12 份，无遗留产物）；
- 首帧是任务页而不是静态标题页，且旁白在前 10 秒念出命令与预期结果；
- 终端页的每一行都能在真实日志里找到，日志本身以 `[exit 0]` 结束；
- 练习页三件齐全：改哪里、验证命令、可验证答案；
- 讲稿与旁白逐字一致；
- 旁白不含建设过程、内部批次、文档制作术语与 AI 自述；
- 每集 4–7 分钟、1280×720、h264 + aac 48 kHz、有声占比不低于 90%；
- 视频第 2 秒的画面与任务页首帧一致（视频真的从任务页开始）；
- 24 份证据里没有密钥、endpoint、请求头或本机路径。

加 `--commands` 会把 12 条运行命令重跑一遍，日志写到 `05-evidence/replay/`。

## TTS 隐私边界

`requirements-tts.txt` 固定 `edge-tts==7.2.3`。edge-tts 是在线服务，因此只允许发送
`narration`：命令、路径、源码、endpoint 与凭证都留在本地。`build_audio.py` 在合成前会扫描
旁白，命中 URL、本机路径、疑似密钥、请求头或内部服务名时直接拒绝合成。
