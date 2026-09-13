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
    #: 真实模式下让学员一眼分清的三类事实。
    #: kernel_behavior —— MiniMax-backed kernel 真的做了什么；
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
        "教学补齐 + 结构性边界",
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
        kernel_behavior="换成 MiniMax 只换了内核这一个替换单元，编排层代码一行未改。",
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
    print(f"  - MiniMax-backed kernel 行为: {lesson.kernel_behavior}")
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
