"""Teaching metadata and fail-loud checks shared by iota-example modules."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NoReturn, TypeVar

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


LESSONS = {
    "M01-tool-pipeline": Lesson(
        "M01 · 工具管线",
        "理解 iota 自有工具槽如何获得具名、可逆的处理阶段。",
        ("stage 安装顺序与幂等行为", "错名 stage 是否明确拒绝", "effect 回收后 handler 是否恢复"),
        "教学补齐 + 结构性边界",
        "ToolPipeline 可治理 iota 自有工具槽，但不冒充内核内部工具可见性控制。",
    ),
    "M02-context-assembly-economics": Lesson(
        "M02 · 上下文装配与经济学",
        "观察作用域记忆如何进入 Prompt，并识别仍由内核拥有的压缩边界。",
        ("user/project/session scope", "记忆注入的默认开关", "编排层是否声明 compression seam"),
        "语义等价 + 结构性边界",
        "iota 能组织作用域记忆；模型请求的完整装配与压缩仍属于内核。",
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
    ),
    "M04-agent-loop-intervention": Lesson(
        "M04 · Agent 循环与干预面",
        "区分标准事件流、节点 hook 与内核运行中的消息注入。",
        ("AgentEvent 顺序", "after_node_result 的执行", "mid-turn 注入是否属于编排契约"),
        "语义等价 + 结构性边界",
        "节点边界可观察、可扩展；进行中循环仍由具体内核拥有。",
    ),
    "M05-session-surface": Lesson(
        "M05 · 会话面",
        "读取真实 ConversationStore 与 RunStore，并对比 DSH 日志投影契约。",
        ("持久化消息顺序", "run 状态与事件顺序", "事件是否承诺 sequence 字段"),
        "语义等价 + 结构性边界",
        "iota 保存会话和运行事实，但不声称拥有 DSH 的 seq/surface 不变量。",
    ),
    "M06-human-in-the-loop": Lesson(
        "M06 · 人在环路",
        "验证 ACP permission 必定得到答复，并识别计划模式的宿主边界。",
        ("无匹配策略时是否 fail closed", "permission 是否及时答复", "plan mode 位于哪一层"),
        "语义等价 + 结构性边界",
        "权限请求由适配器可靠闭合；计划模式由具体内核或宿主管理。",
    ),
    "M07-execution-backends": Lesson(
        "M07 · 执行侧后端",
        "确认 shell 副作用由 KernelAdapter 执行，而非编排层工具注册表。",
        ("kernel.shell 事件", "工具结果事件", "编排层 shell registry 是否为空"),
        "结构性边界",
        "iota 转发执行事件，但不重写内核的 fs/shell/sandbox 执行栈。",
    ),
    "M08-delegation-presets": Lesson(
        "M08 · 委派与预设",
        "用 GraphSpec 的依赖与绑定表达可验证的节点委派。",
        ("拓扑顺序", "上游输出绑定", "图运行结果"),
        "语义等价",
        "显式 DAG 依赖为委派提供确定的顺序、数据流和失败边界。",
    ),
    "M09-long-running-orchestration": Lesson(
        "M09 · 长任务与编排",
        "观察队列租约、幂等入队与 checkpoint 恢复语义。",
        ("重复 task id 是否幂等", "claim/ack 状态", "checkpoint sequence"),
        "语义等价（iota 提供更多耐久语义）",
        "队列与 checkpoint 让长任务可租约、可恢复，而不只是一段后台进程。",
    ),
    "M10-external-capabilities": Lesson(
        "M10 · 外部能力接入",
        "验证文件系统 Skill 与进程内 MCP 的真实发现和调用路径。",
        ("SKILL.md 同步结果", "MCP tools/list", "MCP tools/call"),
        "语义等价",
        "知识资产与外部工具协议都能通过明确边界接入，默认示例无需网络。",
    ),
    "M11-config-data-infrastructure": Lesson(
        "M11 · 配置与数据设施",
        "区分 profile 投影、可换存储协议与宿主持有的凭证/附件。",
        ("profile 文件是否真实生成", "不支持的布局是否拒绝", "ConversationStore 是否可替换"),
        "语义等价 + 结构性边界",
        "配置和会话存储可治理；凭证与附件不应被硬塞进 AgentConfig。",
    ),
    "M12-framework-mechanisms": Lesson(
        "M12 · 框架机制本体",
        "验证可逆 effect、身份安全 disposer 与 Provider 发现机制。",
        ("LIFO 与幂等 dispose", "失效后注册和错名 capability 的拒绝", "标准 entry-point group"),
        "语义等价 + 结构性边界",
        "iota 借用可逆机制，但不复制 Cordis 的事件总线、Proxy Context 与 HMR 架构。",
    ),
}


def fail(expectation: str, actual: Any = None) -> NoReturn:
    detail = "" if actual is None else f"；实际观察：{actual!r}"
    raise TeachingCheckError(f"教学检查失败：期望 {expectation}{detail}")


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
    print(f"学习目标：{lesson.goal}")
    print("运行时观察：")
    for index, item in enumerate(lesson.observe, 1):
        print(f"  {index}. {item}")
    return lesson


def print_after(lesson: Lesson, result: dict[str, Any]) -> None:
    print("验证结果：")
    for key, value in result.items():
        if key not in {"module", "status", "relationship"}:
            rendered = json.dumps(value, ensure_ascii=False, sort_keys=True)
            print(f"  - {key}: {rendered}")
    print(f"对照关系：{lesson.relationship}")
    print(f"结论：{lesson.conclusion}")
