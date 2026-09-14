"""Unified runtime assembly for iota-example M01-M12.

This single module owns environment loading, offline/real kernels, the network guard, lesson
metadata, fail-loud checks and the WorkshopHarness assembly path. The two providers remain
explicit: deterministic `echo` and MiniMax/Fuyao `anthropic-compat`.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import tempfile
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, NoReturn, TypeVar

from iota_core.adapters.base import KernelAdapter
from iota_core.agent import Agent
from iota_core.capabilities import host_capability_hint, missing_host_capabilities
from iota_core.effects import EffectStack
from iota_core.graph import KernelCapabilities
from iota_core.providers import register_adapter
from iota_core.registry import Registry
from iota_core.runtime import IotaRuntime
from iota_core.storage.in_memory import InMemoryConversationStore
from iota_core.storage.run_store import InMemoryRunStore
from iota_core.types import (
    AgentConfig,
    AgentEvent,
    AgentResult,
    FinalEvent,
    McpServerConfig,
    Message,
    SessionHandle,
    SystemInitEvent,
    TextDeltaEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
    ToolDef,
)

# ── Project environment ───────────────────────────────────────────────────
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
_loaded = False


def load_project_env(path: Path | None = None) -> dict[str, str]:
    """Parse ``KEY=VALUE`` lines into ``os.environ`` without overwriting existing keys."""
    global _loaded
    target = path or _ENV_FILE
    if _loaded and path is None:
        return {}
    if path is None:
        _loaded = True
    applied: dict[str, str] = {}
    if not target.is_file():
        return applied
    for raw in target.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or key in os.environ:
            continue
        os.environ[key] = value
        applied[key] = value
    return applied


# ── Kernel implementations and real configuration ─────────────────────────
AnthropicCompatVendor = Literal["minimax", "fuyao"]

#: Configuration keys accepted from the project environment. ``LLM_*`` is canonical;
#: ``ANTHROPIC_*`` remains compatible with existing local configurations.
CONFIG_VARIABLES = (
    "LLM_API_KEY",
    "LLM_VENDOR",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
)

#: Credential/endpoint/model variables forwarded to the Claude Code subprocess.
FORWARDED = ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL")

CONFIG_SOURCE = "iota-example/.env（已被 git 忽略；模板见 .env.example）"


class KernelUnavailable(RuntimeError):
    """Raised when the real kernel cannot be assembled, with the fix in the message."""


def resolve_anthropic_compat_vendor(
    vendor: str | None,
    *,
    base_url: str | None = None,
    model: str | None = None,
) -> AnthropicCompatVendor:
    """Resolve an explicit vendor or infer Fuyao from its endpoint/model hints."""
    if vendor and vendor.strip():
        normalized = vendor.strip().lower()
        if normalized in {"minimax", "fuyao"}:
            return normalized  # type: ignore[return-value]
        raise KernelUnavailable(
            f"不支持 LLM_VENDOR={vendor!r}（只支持 minimax / fuyao）。"
        )
    hint = f"{base_url or ''} {model or ''}".lower()
    return "fuyao" if "fuyao" in hint or "xiaopeng" in hint else "minimax"


@dataclass(frozen=True, slots=True)
class AnthropicCompatSettings:
    """Values that turn the Claude kernel into a MiniMax/Fuyao-backed kernel."""

    token: str
    base_url: str
    model: str
    vendor: AnthropicCompatVendor

    def kernel_env(self) -> dict[str, str]:
        env = {
            "ANTHROPIC_BASE_URL": self.base_url,
            "ANTHROPIC_AUTH_TOKEN": self.token,
            "ANTHROPIC_MODEL": self.model,
            # The kernel must not silently pick a bundled default model on any tier.
            "ANTHROPIC_DEFAULT_SONNET_MODEL": self.model,
            "ANTHROPIC_DEFAULT_OPUS_MODEL": self.model,
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": self.model,
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        }
        if self.vendor == "fuyao":
            # Fuyao can emit unsigned reasoning. Claude Code would replay that reasoning after a
            # tool result and the Anthropic-compatible endpoint would reject the next request.
            # Keep text/tool blocks while preventing the incompatible thinking block at source.
            env.update(
                {
                    "CLAUDE_CODE_DISABLE_THINKING": "1",
                    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1",
                    "DISABLE_INTERLEAVED_THINKING": "1",
                }
            )
        return env

    def redacted(self) -> str:
        return (
            f"vendor={self.vendor} model={self.model} "
            "endpoint=<anthropic-compatible> token=<redacted>"
        )


def anthropic_compat_settings() -> AnthropicCompatSettings:
    """Read canonical ``LLM_*`` configuration, retaining legacy Anthropic aliases."""
    load_project_env()
    token = (
        os.environ.get("LLM_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN") or ""
    ).strip()
    base_url = (
        os.environ.get("LLM_BASE_URL") or os.environ.get("ANTHROPIC_BASE_URL") or ""
    ).strip()
    model = (os.environ.get("LLM_MODEL") or os.environ.get("ANTHROPIC_MODEL") or "").strip()
    vendor = resolve_anthropic_compat_vendor(
        os.environ.get("LLM_VENDOR"), base_url=base_url, model=model
    )

    missing: list[str] = []
    if not token:
        missing.append("LLM_API_KEY（兼容 ANTHROPIC_AUTH_TOKEN）")
    if not base_url and vendor == "fuyao":
        missing.append("LLM_BASE_URL（Fuyao 必填）")
    if missing:
        raise KernelUnavailable(
            "真实模式缺少配置：" + ", ".join(missing) + "。\n"
            f"  配置来源：{CONFIG_SOURCE}\n"
            "  推荐配置：LLM_API_KEY / LLM_VENDOR / LLM_BASE_URL / LLM_MODEL\n"
            "  真实模式不会退回 EchoKernelAdapter —— 离线演示请显式用 IOTA_PROVIDER=echo。"
        )

    resolved_base_url = base_url or "https://api.minimaxi.com/anthropic"
    resolved_model = model or ("MiniMax-M3" if vendor == "minimax" else "fuyao-coding")
    return AnthropicCompatSettings(
        token=token,
        base_url=resolved_base_url,
        model=resolved_model,
        vendor=vendor,
    )


def resolve_cli() -> str | None:
    """Locate the Claude Code CLI the SDK will drive (``None`` lets the SDK resolve it)."""
    explicit = os.environ.get("CLAUDE_CLI_PATH", "").strip()
    if explicit:
        if not Path(explicit).is_file():
            raise KernelUnavailable(f"CLAUDE_CLI_PATH 指向的文件不存在：{explicit}")
        return explicit
    return shutil.which("claude")


def preflight() -> dict[str, str]:
    """Check every real-kernel prerequisite before a module starts."""
    settings = anthropic_compat_settings()
    if importlib.util.find_spec("claude_agent_sdk") is None:
        raise KernelUnavailable(
            "缺少 claude-agent-sdk（真实内核的运行依赖）。\n"
            "  安装：iota-example/.venv/bin/python -m pip install 'claude-agent-sdk>=0.2,<1'\n"
            "  或声明式安装：uv sync --extra real"
        )
    cli = resolve_cli()
    if cli is None:
        raise KernelUnavailable(
            "找不到 Claude Code CLI。claude-agent-sdk 靠它驱动内核进程。\n"
            "  安装后确保 `claude` 在 PATH 上，或设置 CLAUDE_CLI_PATH=<binary>。"
        )
    return {
        "kernel": "claude",
        "vendor": settings.vendor,
        "model": settings.model,
        "sdk": "claude-agent-sdk",
        "cli": Path(cli).name,
    }


def create_workspace() -> Path:
    """Create a throwaway directory for the real kernel process."""
    return Path(tempfile.mkdtemp(prefix="iota-real-"))


def build_adapter(
    *, allow_shell: bool = False, timeout: float = 180.0, workspace: Path | None = None
) -> Any:
    """Build an Anthropic-compatible ClaudeAdapter for MiniMax or Fuyao."""
    from iota_core.adapters.claude import ClaudeAdapter

    settings = anthropic_compat_settings()
    preflight()
    root = workspace or create_workspace()
    return ClaudeAdapter(
        model=settings.model,
        env=settings.kernel_env(),
        cwd=str(root),
        cli_path=resolve_cli(),
        allowed_tools=["Bash"] if allow_shell else [],
        disallowed_tools=[] if allow_shell else ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permission_mode="bypassPermissions" if allow_shell else "default",
        max_turns=4,
        timeout=timeout,
        thinking=False,
        setting_sources=[],
    )


class EchoKernelAdapter(KernelAdapter):
    """A deterministic adapter implementation with no I/O."""

    name = "echo"
    provides = frozenset()
    requires = frozenset()

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.started = False
        self.closed = False
        self.sessions: dict[str, AgentConfig] = {}
        self.observed_prompts: list[str] = []
        self.observed_memory: list[list[Message]] = []

    async def start(self) -> None:
        self.started = True

    async def capabilities(self) -> dict[str, Any]:
        return {
            "streaming": True,
            "concurrent_sessions": True,
            "max_concurrency": 8,
            "per_session_model": True,
            "per_session_system_prompt": True,
            "per_session_skills": True,
            "per_session_middleware": False,
            "mcps": False,
            "incremental_tool_events": True,
            "enforces_max_iterations": True,
            "enforces_max_tool_calls": True,
            "enforces_token_budget": False,
        }

    async def create_session(
        self,
        cfg: AgentConfig,
        tools: list[ToolDef],
        mcps: list[McpServerConfig],
    ) -> SessionHandle:
        del tools, mcps
        session_id = f"echo-session-{len(self.sessions) + 1}"
        self.sessions[session_id] = cfg.model_copy(deep=True)
        return SessionHandle(
            session_id=session_id,
            kernel=self.name,
            extra={"model": cfg.model or "echo-v1"},
        )

    def has_session(self, session: SessionHandle) -> bool:
        return session.session_id in self.sessions

    async def stream(
        self,
        session: SessionHandle,
        prompt: str,
        memory: list[Message],
    ) -> AsyncIterator[AgentEvent]:
        self.observed_prompts.append(prompt)
        self.observed_memory.append(list(memory))
        yield SystemInitEvent(model=session.extra.get("model"), raw={"offline": True})
        if prompt.startswith("shell:"):
            command = prompt.removeprefix("shell:").strip()
            yield ToolCallStartEvent(
                id="kernel-shell-1", name="kernel.shell", args={"command": command}
            )
            output = f"echo-kernel handled shell request: {command}"
            yield ToolCallResultEvent(id="kernel-shell-1", ok=True, output=output)
            yield TextDeltaEvent(text=output)
            yield FinalEvent(text=output, session_id=session.session_id)
            return
        text = f"echo:{prompt}"
        yield TextDeltaEvent(text=text)
        yield FinalEvent(text=text, session_id=session.session_id)

    async def close(self, session: SessionHandle | None = None) -> None:
        if session is None:
            self.sessions.clear()
            self.closed = True
        else:
            self.sessions.pop(session.session_id, None)


# ── Offline network guard ──────────────────────────────────────────────────
class OfflineViolation(RuntimeError):
    """Raised when a module attempts network I/O."""


def install_network_guard() -> Callable[[], None]:
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_create_connection = socket.create_connection

    def blocked(*_args: Any, **_kwargs: Any) -> None:
        raise OfflineViolation("outbound network is disabled for iota-example")

    def blocked_ex(*_args: Any, **_kwargs: Any) -> int:
        raise OfflineViolation("outbound network is disabled for iota-example")

    socket.socket.connect = blocked  # type: ignore[method-assign]
    socket.socket.connect_ex = blocked_ex  # type: ignore[method-assign]
    socket.create_connection = blocked  # type: ignore[assignment]

    def restore() -> None:
        socket.socket.connect = original_connect  # type: ignore[method-assign]
        socket.socket.connect_ex = original_connect_ex  # type: ignore[method-assign]
        socket.create_connection = original_create_connection

    return restore


# ── Module metadata and assertions ─────────────────────────────────────────
T = TypeVar("T")


class TeachingCheckError(RuntimeError):
    """Raised when an observed fact does not match a lesson's stated expectation."""


@dataclass(frozen=True, slots=True)
class Lesson:
    title: str
    goal: str
    observe: tuple[str, ...]
    relationship: str
    conclusion: str
    #: 真实模式下让读者一眼分清的三类事实。
    #: kernel_behavior —— Anthropic-compatible kernel 真的做了什么；
    #: orchestration   —— iota 编排层本地机制断言（不需要模型也成立）；
    #: not_iota        —— 明确不属于 iota、由内核或宿主拥有的能力。
    kernel_behavior: str = ""
    orchestration: str = ""
    not_iota: str = ""

    def real_prompt(self) -> str:
        """真实内核 probe 的提问：短、确定，避免把结论寄托在模型创造力上。"""
        return (
            f"请用一句话回答：{self.goal}"
            " 回答控制在 40 字以内，只输出这句话。"
        )


LESSONS = {
    "M01-tool-pipeline": Lesson(
        "M01 · 工具管线",
        "理解 iota 自有工具槽如何获得具名、可逆的处理阶段。",
        ("stage 安装顺序与幂等行为", "错名 stage 是否明确拒绝", "effect 回收后 handler 是否恢复"),
        "机制补齐 + 结构性边界",
        "ToolPipeline 可治理 iota 自有工具槽，但不冒充内核内部工具可见性控制。",
        kernel_behavior="内核按自己的工具可见性规则作答，编排层不干预它内部的工具选择。",
        orchestration="stage 安装、幂等、错名拒绝与 effect 回收都在本地断言，不依赖模型。",
        not_iota="内核内部工具的可见性收窄与执行前策略不属于 iota。",
    ),
    "M02-context-assembly-economics": Lesson(
        "M02 · 上下文装配与经济学",
        "观察作用域记忆如何进入 Prompt，并识别仍由内核拥有的压缩边界。",
        ("user/project/session scope", "记忆注入的默认开关", "编排层是否声明 compression seam"),
        "语义等价 + 结构性边界",
        "iota 能组织作用域记忆；模型请求的完整装配与压缩仍属于内核。",
        kernel_behavior="内核自己装配完整 Prompt 并决定历史怎么进上下文。",
        orchestration="作用域记忆前缀的拼装、默认关闭开关与 AgentConfig 字段边界在本地断言。",
        not_iota="Prompt 完整装配与历史压缩由内核拥有，AgentConfig 不伪造 compression seam。",
    ),
    "M03-inference-service-access": Lesson(
        "M03 · 推理服务接入",
        "理解 iota 以整个 KernelAdapter 为替换单元的设计。",
        (
            "Provider 注册的替换粒度",
            "ACP capability 声明",
            "不支持的模型 middleware 是否编译期拒绝",
        ),
        "结构性边界",
        "iota 替换整个内核适配器，不在编排层仿造 DSH 的 LLM middleware。",
        kernel_behavior="切换 MiniMax/Fuyao 只换内核配置这一个替换单元，编排层代码一行未改。",
        orchestration="Provider 注册粒度、ACP capability 声明与不支持项的拒绝在本地断言。",
        not_iota="单次模型调用的 middleware 属于内核，跨进程内核不声明未验证过的能力。",
    ),
    "M04-agent-loop-intervention": Lesson(
        "M04 · Agent 循环与干预面",
        "区分标准事件流、节点 hook 与内核运行中的消息注入。",
        ("AgentEvent 顺序", "after_node_result 的执行", "mid-turn 注入是否属于编排契约"),
        "语义等价 + 结构性边界",
        "节点边界可观察、可扩展；进行中循环仍由具体内核拥有。",
        kernel_behavior="内核在真实循环里产出标准事件流，节点边界之外的过程属于它。",
        orchestration="节点 hook 与图运行状态在本地断言，与具体内核无关。",
        not_iota="进行中循环的 mid-turn 注入不属于编排契约。",
    ),
    "M05-session-surface": Lesson(
        "M05 · 会话面",
        "读取真实 ConversationStore 与 RunStore，并对比 DSH 日志投影契约。",
        ("持久化消息顺序", "run 状态与事件顺序", "事件是否承诺 sequence 字段"),
        "语义等价 + 结构性边界",
        "iota 保存会话和运行事实，但不声称拥有 DSH 的 seq/surface 不变量。",
        kernel_behavior="内核回答被真实写入 ConversationStore 与 RunStore，可读回。",
        orchestration="消息顺序、run 状态与事件 schema 边界在本地断言。",
        not_iota="DSH 的 seq/surface 不变量不属于 iota 的事件 schema。",
    ),
    "M06-human-in-the-loop": Lesson(
        "M06 · 人在环路",
        "验证 ACP permission 必定得到答复，并识别计划模式的宿主边界。",
        ("无匹配策略时是否 fail closed", "permission 是否及时答复", "plan mode 位于哪一层"),
        "语义等价 + 结构性边界",
        "权限请求由适配器可靠闭合；计划模式由具体内核或宿主管理。",
        kernel_behavior="内核在权限策略下作答；请求必定得到答复，不会挂住整轮。",
        orchestration="ACP permission 的 fail-closed 默认与 AgentConfig 字段边界在本地断言。",
        not_iota="计划模式由具体内核或宿主管理，不在编排层。",
    ),
    "M07-execution-backends": Lesson(
        "M07 · 执行侧后端",
        "确认 shell 副作用由 KernelAdapter 执行，而非编排层工具注册表。",
        ("kernel.shell 事件", "工具结果事件", "编排层 shell registry 是否为空"),
        "结构性边界",
        "iota 转发执行事件，但不重写内核的 fs/shell/sandbox 执行栈。",
        kernel_behavior="shell 副作用由内核执行并以工具事件回传，编排层只转发。",
        orchestration="编排层 shell 注册表为空这一条本身就是可运行的边界证据。",
        not_iota="fs/shell/sandbox 执行栈不属于 iota。",
    ),
    "M08-delegation-presets": Lesson(
        "M08 · 委派与预设",
        "用 GraphSpec 的依赖与绑定表达可验证的节点委派。",
        ("拓扑顺序", "上游输出绑定", "图运行结果"),
        "语义等价",
        "显式 DAG 依赖为委派提供确定的顺序、数据流和失败边界。",
        kernel_behavior="内核按节点提示词分别作答，委派顺序由图决定而不是模型自由发挥。",
        orchestration="拓扑顺序、上游输出绑定与图运行结果在本地断言。",
        not_iota="内核内部的子代理实现细节不属于 iota。",
    ),
    "M09-long-running-orchestration": Lesson(
        "M09 · 长任务与编排",
        "观察队列租约、幂等入队与 checkpoint 恢复语义。",
        ("重复 task id 是否幂等", "claim/ack 状态", "checkpoint sequence"),
        "语义等价（iota 提供更多耐久语义）",
        "队列与 checkpoint 让长任务可租约、可恢复，而不只是一段后台进程。",
        kernel_behavior="内核负责单次运行；断点续跑所需的状态不在它手里。",
        orchestration="队列幂等、租约认领与 checkpoint 序号在本地断言。",
        not_iota="单次运行内部的重试细节属于内核。",
    ),
    "M10-external-capabilities": Lesson(
        "M10 · 外部能力接入",
        "验证文件系统 Skill 与进程内 MCP 的真实发现和调用路径。",
        ("SKILL.md 同步结果", "MCP tools/list", "MCP tools/call"),
        "语义等价",
        "知识资产与外部工具协议都能通过明确边界接入，默认示例无需网络。",
        kernel_behavior="内核读到同步进来的 Skill 正文后作答。",
        orchestration="SKILL.md 同步与进程内 MCP 的 tools/list、tools/call 往返在本地断言。",
        not_iota="外部服务本身的可用性不由 iota 承诺。",
    ),
    "M11-config-data-infrastructure": Lesson(
        "M11 · 配置与数据设施",
        "区分 profile 投影、可换存储协议与宿主持有的凭证/附件。",
        ("profile 文件是否真实生成", "不支持的布局是否拒绝", "ConversationStore 是否可替换"),
        "语义等价 + 结构性边界",
        "配置和会话存储可治理；凭证与附件不应被硬塞进 AgentConfig。",
        kernel_behavior="内核在本次配置投影下真实启动并作答。",
        orchestration="profile 投影、不支持布局的拒绝与可替换存储协议在本地断言。",
        not_iota="凭证与附件归宿主，不塞进 AgentConfig。",
    ),
    "M12-framework-mechanisms": Lesson(
        "M12 · 框架机制本体",
        "验证可逆 effect、身份安全 disposer 与 Provider 发现机制。",
        ("LIFO 与幂等 dispose", "失效后注册和错名 capability 的拒绝", "标准 entry-point group"),
        "语义等价 + 结构性边界",
        "iota 借用可逆机制，但不复制 Cordis 的事件总线、Proxy Context 与 HMR 架构。",
        kernel_behavior="内核可整体替换，替换动作本身走可逆 effect。",
        orchestration="LIFO 拆除、幂等 dispose、身份安全 disposer 与 entry-point 发现在本地断言。",
        not_iota="Cordis 的事件总线、Proxy Context 与运行期热替换不属于 iota。",
    ),
}


def fail(expectation: str, actual: Any = None) -> NoReturn:
    detail = "" if actual is None else f"；实际观察：{actual!r}"
    raise TeachingCheckError(f"检查失败：期望 {expectation}{detail}")


def require(condition: object, expectation: str, actual: Any = None) -> None:
    if not condition:
        fail(expectation, actual)


def require_not_none(value: T | None, expectation: str) -> T:
    if value is None:
        fail(expectation, value)
    return value


def print_before(module_dir: Path) -> Lesson:
    lesson = LESSONS[module_dir.name]
    print(f"\n{'█' * 4} {lesson.title} {'█' * 4}")
    print(f"目标：{lesson.goal}")
    print("运行时观察：")
    for index, item in enumerate(lesson.observe, 1):
        print(f"  {index}. {item}")
    return lesson


def require_event_order(observed: list[str], expected: tuple[str, ...]) -> None:
    """按**子序列**校验事件顺序。

    不同内核会在标准事件之间插入自己的事件（step、thinking、工具调用…），
    所以"顺序正确"应表述为"这几个标准事件按序出现"，而不是"事件列表完全等于某个字面量"。
    写成相等会让示例只在 echo 内核下成立，那正是本工程要避免的假象。
    """
    cursor = 0
    for item in observed:
        if cursor < len(expected) and item == expected[cursor]:
            cursor += 1
    if cursor != len(expected):
        fail(f"事件按序包含 {' → '.join(expected)}", observed)


def print_real(lesson: Lesson, evidence: dict[str, Any]) -> None:
    """真实模式专属输出：真实模型 / 真实内核 / 真实响应 + 三类边界结论。"""
    print("真实内核证据：")
    print(f"  - 真实模型: {evidence['model']}")
    print(f"  - 真实内核: {evidence['kernel']}（{evidence['sdk']} + {evidence['cli']}）")
    print(f"  - 真实响应: {evidence['response']}")
    print(f"  - 事件序列: {', '.join(evidence['events'])}")
    print("三类边界：")
    print(f"  - Anthropic-compatible kernel 行为: {lesson.kernel_behavior}")
    print(f"  - iota 编排层本地机制断言 : {lesson.orchestration}")
    print(f"  - 明确不属于 iota 的能力  : {lesson.not_iota}")


def print_after(lesson: Lesson, result: dict[str, Any]) -> None:
    print("验证结果：")
    for key, value in result.items():
        if key not in {"module", "status", "relationship"}:
            rendered = json.dumps(value, ensure_ascii=False, sort_keys=True)
            print(f"  - {key}: {rendered}")
    print(f"对照关系：{lesson.relationship}")
    print(f"结论：{lesson.conclusion}")


# ── Runtime assembly ───────────────────────────────────────────────────────
OFFLINE_PROVIDER = "echo"
REAL_PROVIDER = "anthropic-compat"
PROVIDERS = (OFFLINE_PROVIDER, REAL_PROVIDER)


def selected_provider(provider: str | None = None) -> str:
    """Resolve the provider from the argument, then ``IOTA_PROVIDER``, then offline."""
    load_project_env()
    value = (provider or os.environ.get("IOTA_PROVIDER") or OFFLINE_PROVIDER).strip().lower()
    if value not in PROVIDERS:
        raise KernelUnavailable(
            f"未知 IOTA_PROVIDER={value!r}；可选：{', '.join(PROVIDERS)}。"
            " 真实模式用 anthropic-compat，离线确定性演示用 echo。"
        )
    return value


@dataclass(slots=True)
class WorkshopHarness:
    """Own all process registrations and runtime resources for one example."""

    effects: EffectStack
    registry: Registry
    adapter: KernelAdapter
    conversation_store: InMemoryConversationStore
    run_store: InMemoryRunStore
    runtime: IotaRuntime
    provider: str = OFFLINE_PROVIDER
    kernel: str = OFFLINE_PROVIDER
    model: str | None = None
    capabilities: KernelCapabilities | None = None
    preflight_report: dict[str, str] = field(default_factory=dict)
    #: 真实内核进程的工作目录（离线模式为 None）。示例只能通过它给内核准备输入。
    workspace: Path | None = None

    @property
    def real(self) -> bool:
        """Whether this harness uses the real Anthropic-compatible kernel."""
        return self.provider == REAL_PROVIDER

    async def start(self) -> WorkshopHarness:
        missing = missing_host_capabilities(self.adapter.requires)
        if missing:
            hints = "; ".join(host_capability_hint(item) for item in missing)
            raise RuntimeError(
                f"{self.kernel} kernel has unmet host capabilities {missing}: {hints}"
            )
        await self.adapter.start()
        self.capabilities = KernelCapabilities.from_adapter_payload(
            await self.adapter.capabilities()
        )
        return self

    def agent(self, *, name: str, **config: Any) -> Agent:
        if self.model is not None:
            config.setdefault("model", self.model)
        return self.runtime.create_agent(AgentConfig(name=name, kernel=self.kernel, **config))

    async def run(self, prompt: str, *, name: str = "workshop-agent") -> AgentResult:
        return await self.runtime.run(self.agent(name=name), prompt)

    async def stream(self, prompt: str, *, name: str = "workshop-agent") -> list[AgentEvent]:
        return [event async for event in self.runtime.stream(self.agent(name=name), prompt)]

    async def close(self) -> None:
        await self.runtime.close()
        await self.effects.adispose()


async def create_harness(
    provider: str | None = None,
    *,
    allow_shell: bool = False,
) -> WorkshopHarness:
    """Assemble the registry, effects, provider, stores and adapter in one place."""
    resolved = selected_provider(provider)
    effects = EffectStack("iota-example")
    registry = Registry()
    conversation_store = InMemoryConversationStore()
    run_store = InMemoryRunStore()

    adapter: KernelAdapter
    report: dict[str, str] = {}
    model: str | None = None
    workspace: Path | None = None
    if resolved == REAL_PROVIDER:
        # Fail before any module runs: credentials, SDK and CLI are all checked here.
        report = preflight()
        workspace = create_workspace()
        adapter = build_adapter(allow_shell=allow_shell, workspace=workspace)
        kernel = adapter.name
        model = report["model"]
        effects.push(
            register_adapter(
                kernel,
                lambda _build: build_adapter(allow_shell=allow_shell, workspace=workspace),
            ),
            f"provider:{kernel}",
        )
    else:
        adapter = EchoKernelAdapter()
        kernel = adapter.name
        effects.push(
            register_adapter(kernel, lambda _build: EchoKernelAdapter()),
            f"provider:{kernel}",
        )

    runtime = IotaRuntime(
        adapters={kernel: adapter},
        registry=registry,
        conversation_store=conversation_store,
        run_store=run_store,
    )
    harness = WorkshopHarness(
        effects=effects,
        registry=registry,
        adapter=adapter,
        conversation_store=conversation_store,
        run_store=run_store,
        runtime=runtime,
        provider=resolved,
        kernel=kernel,
        model=model,
        preflight_report=report,
        workspace=workspace,
    )
    return await harness.start()
