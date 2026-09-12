# DSH / iota 三讲教学工作坊

本目录把 `dsh-example` 与 `iota-example` 的 M01–M12 教学工程组织为三讲中文课程：

1. **一个工具要走完的十二道关**：16 页，12 分 26 秒。从一个删文件的需求出发，
   顺着注册、权限、执行、审计走完十二个方向，最后收回到同一个装配点。
2. **同样十二个方向，换一层来做**：14 页，12 分 18 秒。先用执行栈说清边界为什么不同，
   再逐段讲哪里对得上、哪里对不上、为什么有的地方不该硬对。
3. **缝开在哪一层，就选哪一个**：10 页，12 分 16 秒。只看三个决策点，
   收束到选型、决策树和三种要避开的做法。

## 交付物

- `00-brief/`：已确认的主题 brief 与 intake answers。
- `01-scripts/`：逐页中文旁白与复现命令。
- `02-decks/`：lusine presentation、音频 manifest 与 edge-tts profile。
- `03-public/`：40 个旁白 MP3、架构图和真实终端证据图。
- `04-out/`：三份可编辑 PPTX 与三份带旁白 MP4。
- `05-evidence/`：40 条命令日志、三页抽帧/OCR 和 G5–G8 验收记录。
- `tools/`：内容、配图、抽帧和全量验证脚本。

## 本地验证

从仓库根目录运行：

```bash
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/validate_workshop.py
```

验证器检查：brief 必答项、3 个 deck/40 页、讲稿同步、资源路径、40 个非静音 MP3、manifest 时长、
PPTX OpenXML、MP4 音视频流、12–18 分钟范围、终端证据与旁白脱敏。此外还强制三条讲述质量约束：
每讲有声占比不低于 90%（不许用静音撑时长）、内部工作语言零出现、AI 腔句式零出现。

逐条重跑讲稿命令时，按 10 条一批执行：

```bash
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/validate_workshop.py \
  --commands --start 0 --end 10
```

其余区间依次为 `10..20`、`20..30`、`30..40`。

## 内容与配图再生成

```bash
env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/build_content.py

env -u PYTHONHOME -u PYTHONPATH \
  iota-example/.venv/bin/python dsh-workshop/tools/build_images.py
```

`build_content.py` 会重建 presentation、讲稿并把 manifest 复位为空；修改 narration 后必须重新生成旁白和 manifest，再导出 PPTX/MP4。

## TTS 隐私边界

TTS 依赖固定在 `requirements-tts.txt` 的 `edge-tts==7.2.3`。edge-tts 是在线服务：调用时仅允许发送 presentation 中已脱敏的 `narration`，不得发送复现命令、项目路径、源码、内部地址、凭证或个人信息。当前 40 段 narration 已通过九类敏感模式扫描。

默认教学入口本身保持离线；只有显式重新生成旁白时会访问在线语音服务。

完整验收证据见 [`05-evidence/validation-report.md`](05-evidence/validation-report.md)。
