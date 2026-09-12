# Segment C 教学媒体验收报告

验收日期：2026-09-12。全部产物位于 `dsh-workshop/`，未 push。

## 结果总览

| 门禁 | 结果 | 机器证据 |
|---|---|---|
| G5 brief | PASS | `schemaVersion:1`、`kind:topic-intent`、`status:confirmed`，12 个核心必答字段非空 |
| G6 deck | PASS | lusine 三份 `validate-deck` 全绿；页数 16/14/10，总计 40；`stats≤4`、`nodes≤5`、资源路径无绝对路径与 `..` |
| G7 旁白 | PASS | 40/40 MP3；FFmpeg `volumedetect` 非静音；manifest 与 ffprobe 实测时长误差小于 0.05 秒 |
| G8 出片 | PASS | 3 PPTX + 3 MP4；lusine `npm run verify` 8/8；40/40 讲稿命令 exit 0；三页交叉抽检通过 |

## 三讲媒体

| 讲次 | 主线 | 页数 | 成片时长 | 有声占比 |
|---|---|---:|---:|---:|
| 第一讲：一个工具要走完的十二道关 | 从一个删文件的需求出发，串起十二个方向，收回到同一个装配点 | 16 | 745.9s | 94.6% |
| 第二讲：同样十二个方向，换一层来做 | 用执行栈说清边界为什么不同，逐段讲对得上与对不上 | 14 | 737.9s | 93.3% |
| 第三讲：缝开在哪一层，就选哪一个 | 三个决策点收束到选型、决策树与反模式 | 10 | 736.0s | 96.3% |

三讲均在 12–18 分钟。时间轴按 lusine `max(minDurationSec, audioDuration + tailFrames)` 计算，
每页旁白基本填满页面，换页停顿约 1–2 秒，不存在长段静音。三份 MP4 均为 H.264 1280×720 + AAC
48kHz 双声道，末尾帧可解码，lusine 成片音频门禁通过。

## 讲述质量约束（可执行）

验证器除结构与媒体外，还强制三条内容约束，任一违反即失败：

1. **有声占比 ≥ 90%**：防止用静音撑时长。当前 94.6% / 93.3% / 96.3%。
2. **内部工作语言零出现**：内部对齐标签、决策编号等一律不得进入观众可见文本或旁白。
3. **AI 腔句式零出现**：如「关键结论是」「值得注意的是」「综上」「首先，」等元评论式表达。

## 三页画面 / 旁白 / 讲稿抽检

抽检位置按叙事结构选取，而不是取方便的帧：

| 讲次 | 抽检页 | 时间点 | OCR 读到的画面文字 |
|---|---|---:|---|
| 第一讲 | 第 1 页 `dsh-opening` | 5.0s | 「从一个删文件的工具说起」「一个需求牵出十二个方向，最后都回到同一个装配点」 |
| 第二讲 | 第 2 页 `iota-boundary` | 57.0s | 「边界画在哪儿，取决于谁在执行」＋宿主 / 编排层 / 内核 / 模型与工具四层 |
| 第三讲 | 第 10 页 `choice-closing` | 669.0s | 「别用长得像，去替代说得清谁拥有它」 |

三页均为 1280×720 非空画面；每页 JSON narration 与 Markdown 讲稿逐字一致，manifest 音频映射一致。
结构化记录见 `frame-samples.json`，抽帧见 `frames/`，OCR 原文见 `frame-ocr.txt`。

## 命令与工具链

- 三份讲稿共 40 页、40 条复现命令；分两批实际执行，40/40 exit 0。
- 每条脱敏输出保存在 `commands/command-01.txt` 至 `command-40.txt`。
- lusine `npm run verify`：eslint、renderer tsc、scripts tsc、ruff、52 个 Node tests、
  30 passed/1 skipped Python tests、示例 deck、WCAG 对比度共 8/8 通过。

## 隐私与仓库边界

- edge-tts 固定为 `7.2.3`，voice 为 `zh-CN-XiaoxiaoNeural`，rate 为 `-5%`。
- 在线语音服务仅接收 40 段已脱敏 narration；未发送命令、路径或源码。
- narration 对代码托管名、包索引名、URL、邮箱、口令、token、credential 和用户路径等模式扫描为零命中。
- 命令证据中的本机仓库与临时目录已替换为 `<repo>` / `<temp>`。
- lusine 开始时已有 35 行用户本地状态；结束后内容与顺序完全相同，SHA-256 均为
  `11e81ab7ae535e8f5260b032511e4b6355145b8be433305b421d1f834c4502b3`。未写入其 `example/`。
- iota-core 工作区干净；主仓库本次变更全部位于 `dsh-workshop/`。

## 复核入口

```bash
env -u PYTHONHOME -u PYTHONPATH iota-example/.venv/bin/python dsh-workshop/tools/validate_workshop.py
```

逐条命令复核可追加 `--commands --start 0 --end 20`，再执行 `--start 20 --end 40`。
