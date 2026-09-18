"""Unified runtime assembly for iota-example M01-M12.

This single module owns environment loading, the real kernel adapters, lesson metadata,
fail-loud checks and the WorkshopHarness assembly path.

Two real kernels can be selected with ``IOTA_KERNEL`` — ``hermes_direct`` (default, OpenAI
compatible, in-process) and ``claude`` (Anthropic compatible, drives the Claude Code CLI).
Either way a missing credential, package or CLI aborts before a module starts; nothing is
substituted for the model, so an unconfigured run fails instead of quietly answering itself.
"""

from __future__ import annotations

import importlib.util
import inspect
import os
import re
import shutil
import tempfile
import time
from collections.abc import AsyncIterator, Sequence
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
from iota_core.types import AgentConfig, AgentEvent, AgentResult

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


#: 可选内核实现在 iota-core 里各有登记名。示例默认用 ``hermes_direct``：它走
#: **OpenAI 兼容**协议（``HERMES_BASE_URL`` / ``HERMES_API_KEY`` / ``HERMES_MODEL``），
#: 同进程直调，既不需要 claude CLI，也不依赖 Anthropic 网关。``claude`` 仍然保留，
#: 用于对照 anthropic-compat 那条路径。
KERNEL_ADAPTERS = ("hermes_direct", "claude")
DEFAULT_KERNEL = "hermes_direct"

#: 内核名 → 日志/证据行里的 provider 标签。内核换了标签就得跟着走：``anthropic-compat``
#: 只对 claude 那条 Anthropic 网关路径成立，Hermes 走的是 OpenAI 兼容协议。
REAL_PROVIDER = "anthropic-compat"
PROVIDER_LABELS = {"claude": "anthropic-compat", "hermes_direct": "openai-compat"}
PROVIDERS = (REAL_PROVIDER,)


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
            "运行缺少配置：" + ", ".join(missing) + "。\n"
            f"  配置来源：{CONFIG_SOURCE}\n"
            "  推荐配置：LLM_API_KEY / LLM_VENDOR / LLM_BASE_URL / LLM_MODEL\n"
            "  没有配置就没有内核：工程不提供任何替代模型的本地实现。"
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


def selected_kernel(kernel: str | None = None) -> str:
    """Resolve the kernel adapter from the argument, then ``IOTA_KERNEL``."""
    load_project_env()
    value = (kernel or os.environ.get("IOTA_KERNEL") or DEFAULT_KERNEL).strip().lower()
    if value not in KERNEL_ADAPTERS:
        raise KernelUnavailable(
            f"未知 IOTA_KERNEL={value!r}；可选：{', '.join(KERNEL_ADAPTERS)}。"
            " 默认 hermes_direct（OpenAI 兼容，同进程直调）。"
        )
    return value


@dataclass(frozen=True, slots=True)
class HermesSettings:
    """Values that point a Hermes kernel at any OpenAI-compatible endpoint.

    Hermes 读 ``HERMES_BASE_URL`` / ``HERMES_API_KEY`` / ``HERMES_MODEL``（其次
    ``OPENAI_*``）。这里把工程既有的 ``LLM_*`` 约定翻译过去，并在 base_url 缺少
    ``/v1`` 时补上 —— 多数网关（含 fuyao）的 OpenAI 端点在 ``/v1`` 下。
    """

    base_url: str
    api_key: str
    model: str

    def kernel_env(self) -> dict[str, str]:
        return {
            "HERMES_BASE_URL": self.base_url,
            "HERMES_API_KEY": self.api_key,
            "HERMES_MODEL": self.model,
        }

    def redacted(self) -> str:
        return f"model={self.model} endpoint=<openai-compatible> token=<redacted>"


def hermes_settings() -> HermesSettings:
    """Read OpenAI-compatible configuration for the Hermes kernel.

    ``HERMES_*`` is canonical; ``LLM_*`` / ``OPENAI_*`` remain compatible so the
    project keeps one ``.env`` across both kernel paths.
    """
    load_project_env()
    base_url = (
        os.environ.get("HERMES_BASE_URL")
        or os.environ.get("LLM_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or ""
    ).strip()
    api_key = (
        os.environ.get("HERMES_API_KEY")
        or os.environ.get("LLM_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()
    model = (
        os.environ.get("HERMES_MODEL") or os.environ.get("LLM_MODEL") or "fuyao-coding"
    ).strip()

    missing: list[str] = []
    if not api_key:
        missing.append("LLM_API_KEY（兼容 HERMES_API_KEY / OPENAI_API_KEY）")
    if not base_url:
        missing.append("LLM_BASE_URL（兼容 HERMES_BASE_URL / OPENAI_BASE_URL）")
    if missing:
        raise KernelUnavailable(
            "运行缺少配置：" + ", ".join(missing) + "。\n"
            f"  配置来源：{CONFIG_SOURCE}\n"
            "  Hermes 内核走 OpenAI 兼容协议，需要 base_url 与 api_key。\n"
            "  没有配置就没有内核：工程不提供任何替代模型的本地实现。"
        )

    # 网关的 OpenAI 端点统一在 /v1 下；已带路径的 base_url 原样保留。
    normalized = base_url.rstrip("/")
    if not Path(normalized).name.startswith("v1") and "/v1" not in normalized:
        normalized = f"{normalized}/v1"
    return HermesSettings(base_url=normalized, api_key=api_key, model=model)


def preflight() -> dict[str, str]:
    """Check every real-kernel prerequisite before a module starts."""
    kernel = selected_kernel()
    if kernel == "hermes_direct":
        hermes = hermes_settings()
        # 发行包叫 hermes-agent，导入名却是 `agent`（见 top_level.txt）——按发行名做
        # find_spec("hermes_agent") 会永远为假，把装好的环境误判成缺依赖。
        if importlib.util.find_spec("agent") is None:
            raise KernelUnavailable(
                "缺少 hermes-agent（Hermes 内核的运行依赖）。\n"
                "  安装：uv sync --extra hermes\n"
                "  然后用 uv run 执行，例如：uv run python -m runtime.runner --all"
            )
        return {
            "kernel": kernel,
            "vendor": "openai-compat",
            "model": hermes.model,
            "sdk": "hermes-agent",
            "cli": "(in-process)",
        }

    anthropic = anthropic_compat_settings()
    if importlib.util.find_spec("claude_agent_sdk") is None:
        raise KernelUnavailable(
            "缺少 claude-agent-sdk（claude 内核的运行依赖）。\n"
            "  安装：uv sync --extra real\n"
            "  然后用 uv run 执行，例如：uv run python -m runtime.runner --all"
        )
    cli = resolve_cli()
    if cli is None:
        raise KernelUnavailable(
            "找不到 Claude Code CLI。claude-agent-sdk 靠它驱动内核进程。\n"
            "  安装后确保 `claude` 在 PATH 上，或设置 CLAUDE_CLI_PATH=<binary>。"
        )
    return {
        "kernel": "claude",
        "vendor": anthropic.vendor,
        "model": anthropic.model,
        "sdk": "claude-agent-sdk",
        "cli": Path(cli).name,
    }


def create_workspace() -> Path:
    """Create a throwaway directory for the real kernel process."""
    return Path(tempfile.mkdtemp(prefix="iota-real-"))


@dataclass(frozen=True, slots=True)
class KernelSummary:
    """当前内核的展示信息（供 banner / 结论行使用，不含凭证）。"""

    kernel: str
    model: str
    provider: str


def kernel_settings() -> KernelSummary:
    """按当前 ``IOTA_KERNEL`` 读出用于展示的内核信息。

    日志里的 provider 标签必须跟内核走：``anthropic-compat`` 只对 claude 那条 Anthropic
    网关路径成立，Hermes 走 OpenAI 兼容协议。写死一个标签会让证据行自相矛盾。
    """
    kernel = selected_kernel()
    if kernel == "hermes_direct":
        model = hermes_settings().model
    else:
        model = anthropic_compat_settings().model
    return KernelSummary(
        kernel=kernel,
        model=model,
        provider=PROVIDER_LABELS.get(kernel, REAL_PROVIDER),
    )


def provider_label() -> str:
    """当前内核的 provider 标签（banner 与 ``REAL_ALL_OK`` 行共用）。"""
    return kernel_settings().provider


def build_adapter(
    *, allow_shell: bool = False, timeout: float | None = None, workspace: Path | None = None
) -> Any:
    """按 ``IOTA_KERNEL`` 构造真实内核适配器（默认 hermes_direct）。"""
    kernel = selected_kernel()
    if kernel == "hermes_direct":
        return _build_hermes_adapter(allow_shell=allow_shell, workspace=workspace)
    return _build_claude_adapter(allow_shell=allow_shell, timeout=timeout, workspace=workspace)


def _build_hermes_adapter(*, allow_shell: bool, workspace: Path | None) -> Any:
    """构造同进程直调的 HermesDirectAdapter（OpenAI 兼容协议）。

    **不传 ``project_root`` / ``hermes_home``**：两者都会走 ``ConfigProfileManager``
    投影，而投影要求目标目录里预先存在 ``config.yaml``。示例的内核配置就是端点三件套，
    直接经 ``HERMES_HOME`` 环境变量指向临时目录即可 —— 配置投影那一层归 M11 课专门演示。

    工作目录经 ``TERMINAL_CWD`` 环境变量指定，**不是** ``cwd=`` 参数：``AIAgent`` 的
    构造签名里根本没有 ``cwd``，传了会被 ``_filter_aiagent_kwargs`` 静默丢掉（正是
    iota-core 自己警告的 configured-but-ignored）；Hermes 的工作目录唯一来源是
    ``agent/runtime_cwd.py`` 读的 ``TERMINAL_CWD``。这样 ``harness.workspace`` 才等于
    内核真正读写的目录，M07 "工作目录是唯一输入"那条证据才成立。
    """
    from iota_core.adapters.hermes_direct import HermesDirectAdapter

    settings = hermes_settings()
    preflight()
    root = workspace or create_workspace()
    home = root / "hermes-home"
    home.mkdir(parents=True, exist_ok=True)
    return HermesDirectAdapter(
        base_url=settings.base_url,
        api_key=settings.api_key,
        model=settings.model,
        env={
            **settings.kernel_env(),
            "HERMES_HOME": str(home),
            "TERMINAL_CWD": str(root),
        },
        quiet_mode=True,
        verbose_logging=False,
    )


def _build_claude_adapter(
    *, allow_shell: bool, timeout: float | None, workspace: Path | None
) -> Any:
    """构造 Anthropic 兼容的 ClaudeAdapter（MiniMax / Fuyao）。"""
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
        timeout=REAL_TIMEOUT_MS / 1000 if timeout is None else timeout,
        thinking=False,
        setting_sources=[],
    )


# ── Module metadata and assertions ─────────────────────────────────────────
T = TypeVar("T")


class TeachingCheckError(RuntimeError):
    """Raised when an observed fact does not match a lesson's stated expectation."""


#: 模块目录 → banner 标题。与 `dsh-example` 的 `runModule(module, title, …)` 同一角色：
#: 教学正文（目标、三类边界、结论）都在各模块 README 里，运行日志只留骨架。
MODULE_TITLES = {
    "M01-tool-pipeline": "工具管线：包装、拒绝与可见性归属",
    "M02-context-assembly-economics": "上下文装配与经济学：作用域记忆与内核边界",
    "M03-inference-service-access": "推理服务接入：替换单元与能力声明",
    "M04-agent-loop-intervention": "Agent 循环与干预面：事件、节点 hook 与编译期不变量",
    "M05-session-surface": "会话面：消息存储、运行记录与 schema 边界",
    "M06-human-in-the-loop": "人在环路：命令、权限与计划模式归属",
    "M07-execution-backends": "执行侧后端：副作用归内核，编排层只转发",
    "M08-delegation-presets": "委派与预设：显式 DAG、空 roster 与模型路由",
    "M09-long-running-orchestration": "长任务与编排：幂等入队、租约与 checkpoint",
    "M10-external-capabilities": "外部能力接入：Skill、MCP 与运行时扩展",
    "M11-config-data-infrastructure": "配置与数据设施：投影、存储协议与宿主边界",
    "M12-framework-mechanisms": "框架机制本体：可逆 effect、身份安全与配置叠加",
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


def require_event_order(observed: Sequence[str], expected: tuple[str, ...]) -> None:
    """按**子序列**校验事件顺序。

    不同内核会在标准事件之间插入自己的事件（step、thinking、工具调用…），
    所以"顺序正确"应表述为"这几个标准事件按序出现"，而不是"事件列表完全等于某个字面量"。
    写成相等会让示例只在某一个内核的事件序列下成立，那正是本工程要避免的假象。
    """
    cursor = 0
    for item in observed:
        if cursor < len(expected) and item == expected[cursor]:
            cursor += 1
    if cursor != len(expected):
        fail(f"事件按序包含 {' → '.join(expected)}", observed)


# ── 真实调用证据 ───────────────────────────────────────────────────────────
#: 单次内核调用的墙钟上限；超时按失败计，不按"跳过"计。
REAL_TIMEOUT_MS = int(os.environ.get("IOTA_REAL_TIMEOUT_MS", "180000"))

#: 证据里代替真实 endpoint 的稳定占位符。
ENDPOINT_LABEL = "anthropic-compatible"


def redact(value: str) -> str:
    """输出脱敏：凭证、endpoint、绝对路径都不进证据。"""
    out = value
    for name in ("LLM_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        token = os.environ.get(name, "")
        if len(token) > 6:
            out = out.replace(token, "<redacted-key>")
    out = re.sub(r"https?://[^\s\"')]+", f"<{ENDPOINT_LABEL}>", out)
    out = re.sub(r"/(?:Users|home|private|var|tmp)/[^\s\"')]+", "<path>", out)
    return out


def sample(text: str, limit: int = 72) -> str:
    """一段真实文本的可展示样本（单行、限长、已脱敏）。"""
    flat = " ".join(redact(text).split())
    return flat if len(flat) <= limit else f"{flat[:limit]}…"


@dataclass(slots=True)
class CallEvidence:
    """一次真实内核调用留下的证据。"""

    seq: int
    kernel: str
    model: str
    ms: int = 0
    text_chars: int = 0
    text_sample: str = ""
    tool_calls: list[str] = field(default_factory=list)
    finish: str = "incomplete"
    input_tokens: int = 0
    output_tokens: int = 0
    failure: str | None = None


_evidence: list[CallEvidence] = []


def all_evidence() -> Sequence[CallEvidence]:
    """至今为止全部真实调用证据（同一进程内共享）。"""
    return _evidence


class CountingKernelAdapter(KernelAdapter):
    """把真实内核适配器包一层：事件一条不改地透传，同时留下调用证据。

    与 `dsh-example` 的 `CountingAnthropicCompatAdapter` 同一角色 —— 它仍是真实
    `KernelAdapter`，所以每个阶段"到底有没有真的调用过内核"是可核验的事实，而不是自报。
    """

    def __init__(self, inner: KernelAdapter, model: str) -> None:
        super().__init__()
        self._inner = inner
        self._model = model
        self.name = inner.name
        self.provides = inner.provides
        self.requires = inner.requires

    async def start(self) -> None:
        await self._inner.start()

    async def capabilities(self) -> dict[str, Any]:
        # hermes_direct 的 capabilities() 是同步实现（与 base 的 async 签名不一致），
        # claude 则是 async；两种形状都要能透传，否则换内核会在装配期直接炸。
        result = self._inner.capabilities()
        if inspect.isawaitable(result):
            return await result
        return result

    async def create_session(self, cfg: Any, tools: Any, mcps: Any) -> Any:
        return await self._inner.create_session(cfg, tools, mcps)

    def has_session(self, session: Any) -> bool:
        return self._inner.has_session(session)

    def check_session_ready(self, session: Any) -> None:
        self._inner.check_session_ready(session)

    async def close(self, session: Any = None) -> None:
        await self._inner.close(session)

    async def stream(self, session: Any, prompt: str, memory: Any) -> AsyncIterator[Any]:
        record = CallEvidence(seq=len(_evidence) + 1, kernel=self.name, model=self._model)
        _evidence.append(record)
        started = time.monotonic()
        text = ""
        try:
            async for event in self._inner.stream(session, prompt, memory):
                if event.type == "text_delta":
                    text += getattr(event, "text", "")
                elif event.type == "tool_call":
                    record.tool_calls.append(getattr(event, "name", "?"))
                elif event.type == "final":
                    text = text or getattr(event, "text", "")
                    record.finish = "error" if getattr(event, "is_error", False) else (
                        getattr(event, "subtype", None) or "stop"
                    )
                    usage = getattr(event, "usage", None)
                    if usage is not None:
                        data = usage if isinstance(usage, dict) else usage.to_dict()
                        record.input_tokens = int(data.get("input_tokens", 0))
                        record.output_tokens = int(data.get("output_tokens", 0))
                yield event
        except Exception as exc:
            record.failure = redact(str(exc)) or exc.__class__.__name__
            record.finish = "error"
            raise
        finally:
            record.ms = int((time.monotonic() - started) * 1000)
            record.text_chars = len(text)
            record.text_sample = sample(text)


# ── Runtime assembly ───────────────────────────────────────────────────────


def selected_provider(provider: str | None = None) -> str:
    """Resolve the provider from the argument, then ``IOTA_PROVIDER``."""
    load_project_env()
    value = (provider or os.environ.get("IOTA_PROVIDER") or REAL_PROVIDER).strip().lower()
    if value not in PROVIDERS:
        raise KernelUnavailable(
            f"未知 IOTA_PROVIDER={value!r}；唯一可选：{', '.join(PROVIDERS)}。"
            " 本工程只用真实内核，没有可切换的本地替代实现。"
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
    provider: str = REAL_PROVIDER
    kernel: str = ""
    model: str | None = None
    capabilities: KernelCapabilities | None = None
    preflight_report: dict[str, str] = field(default_factory=dict)
    #: 内核进程的工作目录。示例只能通过它给内核准备输入。
    workspace: Path | None = None

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
    selected_provider(provider)
    effects = EffectStack("iota-example")
    registry = Registry()
    conversation_store = InMemoryConversationStore()
    run_store = InMemoryRunStore()

    # Fail before any module runs: credentials, SDK and CLI are all checked here.
    report = preflight()
    workspace = create_workspace()
    # 真实适配器外面包一层计数器：事件透传，同时留下"这一阶段确实调用过内核"的证据。
    adapter: KernelAdapter = CountingKernelAdapter(
        build_adapter(allow_shell=allow_shell, workspace=workspace), report["model"]
    )
    kernel = adapter.name
    effects.push(
        register_adapter(
            kernel,
            lambda _build: build_adapter(allow_shell=allow_shell, workspace=workspace),
        ),
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
        provider=PROVIDER_LABELS.get(kernel, REAL_PROVIDER),
        kernel=kernel,
        model=report["model"],
        preflight_report=report,
        workspace=workspace,
    )
    return await harness.start()
