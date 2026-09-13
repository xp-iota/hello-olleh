"""M07: the execution-side shell event is emitted by the kernel adapter.

The boundary is the lesson. iota forwards a prompt, the *kernel* performs the side effect and
reports it back as tool events, and the orchestration layer's own tool registry stays empty.
That empty registry is not an omission — it is the runnable evidence that fs/shell/sandbox do
not belong to this layer.

Both providers exercise the same claim with the kernel they actually have:

* offline — the deterministic kernel answers a ``shell:`` request with kernel.shell events.
* real    — the MiniMax-backed kernel is asked to run a command with its own Bash tool, so the
  tool events come from inside the kernel process, not from anything iota registered.
"""

from __future__ import annotations

import uuid
from typing import Any

from iota_core.types import ToolCallResultEvent, ToolCallStartEvent

from runtime.harness import WorkshopHarness
from runtime.teaching import require

OFFLINE_PROMPT = "shell: printf offline"
PROOF_FILE = "kernel-proof.txt"


def real_prompt() -> str:
    return (
        f"当前目录下有一个 {PROOF_FILE}。请用 Bash 工具读出它的内容，"
        "然后只回复文件里那一行，不要解释、不要加引号。"
    )


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    # 真实模式下故意让任务无法凭猜测完成：token 是本次运行才生成的，
    # 只有真的去执行一次命令才能读到。这样"执行归内核"就不是一句断言，而是一条证据。
    token = ""
    if harness.real:
        workspace = harness.workspace
        require(workspace is not None, "真实内核有自己的工作目录", workspace)
        assert workspace is not None
        token = f"kernel-shell-{uuid.uuid4().hex[:10]}"
        (workspace / PROOF_FILE).write_text(f"{token}\n", encoding="utf-8")
    prompt = real_prompt() if harness.real else OFFLINE_PROMPT
    events = await harness.stream(prompt)
    starts = [event for event in events if isinstance(event, ToolCallStartEvent)]
    results = [event for event in events if isinstance(event, ToolCallResultEvent)]
    require(len(starts) >= 1, "内核发出至少一次工具调用 start（执行归内核）", starts)
    require(
        any(result.ok for result in results),
        "内核发出至少一次成功的工具结果",
        [(result.id, result.ok) for result in results],
    )
    if harness.real:
        seen = "\n".join(str(getattr(event, "output", "")) for event in results)
        answered = token in seen or token in "".join(
            str(getattr(event, "text", "")) for event in events
        )
        require(answered, "内核真的读到了本次生成的 token（凭猜测答不出来）", token)
    else:
        require(
            starts[0].name == "kernel.shell",
            "离线内核用 kernel.shell 表达这次执行",
            starts[0].name,
        )
    require(
        harness.registry.tools.list() == [],
        "编排层不注册 shell 工具",
        harness.registry.tools.list(),
    )
    return {
        "module": "M07",
        "status": "ok",
        "relationship": "结构性边界",
        "route": "prompt -> KernelAdapter -> kernel tool events",
        "kernel": harness.kernel,
        "kernel_tool_calls": [event.name for event in starts],
        "execution_proof": "token read by kernel" if harness.real else "kernel.shell event",
        "orchestrator_shell_registry": harness.registry.tools.list(),
    }
