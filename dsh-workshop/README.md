# 一堂 Harness 教学课

本目录把 `dsh-example` 与 `iota-example` 的 M01–M12 教学工程讲成**一堂连续的课**：
40 页、约 37 分钟、**一个视频、一份 PPT**。之前按讲切成三段视频，课堂上要来回切换文件，
现在合并为单一交付物，三讲成为课程的三章。

| 章 | 内容 | 页数 |
|---|---|---|
| 第一章 | 一个工具要走完的十二道关：从注册、权限、执行走到审计，最后收回同一个装配点 | 16 |
| 第二章 | 同样十二个方向，换一层来做：先讲清边界为何不同，再逐段说哪里对得上、哪里不该硬对 | 14 |
| 第三章 | 缝开在哪一层，就选哪一个：三个决策点收束到选型、决策树与要避开的做法 | 10 |

每页画面都带章节条、页码与进度条，讲到哪一章、还剩多少，学员一眼可见。

## 交付物

- `04-out/harness-course.mp4`：**唯一的课程视频**（1280×720、h264 + aac，约 37 分钟）。
- `04-out/harness-course.pptx`：**唯一的课程 PPT**，每页含讲师备注（章节、页码、旁白、复现命令）。
- `01-scripts/harness-course.md`：整堂课的逐页旁白与 40 条复现命令。
- `02-decks/harness-course/`：合并后的课程数据与音频 manifest。
- `03-public/harness-course/`：40 段旁白 MP3、40 张课程画面、课程配图。
- `05-evidence/`：40 条命令日志、三章抽帧与 OCR、验收记录。
- `02-decks/01-*`、`02-*`、`03-*` 与 `01-scripts/0*.md`：**编写来源**（各章旁白与音频），课程由它们合并生成。
- `04-out/superseded-chapter-media/`：合并前的三段旧视频与旧 PPT，仅作留档，教学不再使用。

## 重新生成课程

画面、视频与 PPT 由同一份数据渲染，保证三者一致：

```bash
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/build_images.py

env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/build_course.py
```

`build_images.py` 用真实终端证据重建配图；`build_course.py` 合并三章、渲染 40 页画面、
拼出单个 MP4 并打包 PPT。渲染时会强制两条版式纪律：文字不得越界或压到页脚，
画面不得与空背景无差别（防止渲染失败却静默产出空白页）。

旁白音频复用现有 MP3，不需要联网；只有改写 narration 才需要重新生成语音。

## 本地验证

```bash
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/validate_workshop.py
```

验证器检查：brief 必答项、单课 40 页、讲稿与课程旁白逐字一致、三章来源顺序一致、
40 段非静音 MP3 与 manifest 时长、40 张画面尺寸、PPT 40 页且备注含标题与旁白、
MP4 音视频流与时长、有声占比不低于 90%、**产出目录只允许一个视频**，
以及内部工作语言、AI 腔句式与敏感信息三项零出现。

逐条重跑讲稿命令时按 10 条一批：

```bash
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/validate_workshop.py \
  --commands --start 0 --end 10
```

其余区间依次为 `10..20`、`20..30`、`30..40`。

抽帧与 OCR 证据（证明画面文字真的可读，而不只是存在于数据里）：

```bash
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/sample_media.py
```

## TTS 隐私边界

TTS 依赖固定在 `requirements-tts.txt` 的 `edge-tts==7.2.3`。edge-tts 是在线服务：调用时仅允许发送
presentation 中已脱敏的 `narration`，不得发送复现命令、项目路径、源码、内部地址、凭证或个人信息。
当前 40 段 narration 已通过九类敏感模式扫描。默认教学入口保持离线，只有显式重新生成旁白时会联网。

完整验收证据见 [`05-evidence/validation-report.md`](05-evidence/validation-report.md)。
