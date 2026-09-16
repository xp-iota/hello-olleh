"""精选学习入口：对位 `dsh-example` 的 `npm run learn`（runtime/onboarding.mjs）。

    uv run python -m runtime.learn                 # 交互选择（终端中使用）
    uv run python -m runtime.learn --tour          # 运行 M01 → M02 → M03
    uv run python -m runtime.learn --list          # 列出精选入口
    uv run python -m runtime.learn --module M01    # 运行一个模块

每个精选入口在运行前后各打印一段导读（目标、观察点、收获、下一步），
让"跑一个模块"变成"上一课"；12 个模块的完整教材在 `lessons/` 目录里。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@dataclass(frozen=True, slots=True)
class Lesson:
    """一个精选学习入口：模块 + 导读三段。"""

    id: str
    title: str
    goal: str
    entry: str
    source: str
    observe: tuple[str, ...]
    takeaway: str
    next_: str


LESSONS: tuple[Lesson, ...] = (
    Lesson(
        id="M01",
        title="工具管线",
        goal="看清 iota 只有一层具名可逆包装，审批协议与披露归内核",
        entry="M01-tool-pipeline/run.py",
        source="M01-tool-pipeline/impl/tool_pipeline.py",
        observe=(
            "重复安装同一 stage 是幂等的（already，不叠包装）",
            "外层包装能把内层拒绝改写成成功 —— stages 不是单调守卫",
            "M01.d：内核自己决定调 Bash，编排层工具注册表为空",
        ),
        takeaway="包装能拒绝、能改写，但策略语义（三态审批、per-Agent 披露）属于内核。",
        next_="继续 M02，看作用域记忆怎样替代 DSH 的 Prompt 装配链。",
    ),
    Lesson(
        id="M02",
        title="上下文装配与经济学",
        goal="分清 iota 治理「哪些内容进入下一轮」，而不是「请求怎么被拼出来」",
        entry="M02-context-assembly-economics/run.py",
        source="M02-context-assembly-economics/scenes/01_recall_scoped_memory.py",
        observe=(
            "user/project/session 三个作用域怎样召回出带计数的前缀",
            "AgentConfig 里为什么没有压缩/裁剪字段",
            "写回请求怎样带上解析出的 session scope（iota 版 spill）",
        ),
        takeaway="装配与压缩归内核；作用域记忆可召回、可写回，是 iota 的等价能力。",
        next_="继续 M03，看替换单元为什么是整个 KernelAdapter。",
    ),
    Lesson(
        id="M03",
        title="推理服务接入",
        goal="区分替换单元（KernelAdapter）与编译期能力拒绝",
        entry="M03-inference-service-access/run.py",
        source="M03-inference-service-access/scenes/01_reject_model_middleware.py",
        observe=(
            "引用内核不支持的模型 middleware 时，编译期报什么错",
            "同一个消费循环怎样接真实内核事件流",
            "为什么跨进程内核只声明验证过的能力",
        ),
        takeaway="换内核只换一个适配器；兑现不了的能力在运行前就被拒绝。",
        next_="继续 M04，看编排层能插手的节点边界在哪里。",
    ),
    Lesson(
        id="M04",
        title="Agent 循环与干预面",
        goal="从标准事件流和节点 hook 理解「先观察，再干预」",
        entry="M04-agent-loop-intervention/run.py",
        source="M04-agent-loop-intervention/scenes/03_hook_node_result.py",
        observe=(
            "system_init → text_delta → final 怎样按子序列成立",
            "为什么公开面上没有 mid-turn 注入入口",
            "未注册的 handler 引用怎样在编译期被点名拒绝",
        ),
        takeaway="干预走节点边界与编译期校验；进行中的一轮属于内核。",
        next_="继续 M05，看消息与运行事实怎样分层存储。",
    ),
    Lesson(
        id="M10",
        title="外部能力接入",
        goal="区分数据资产（Skill）、工具协议（MCP）与运行时注册",
        entry="M10-external-capabilities/run.py",
        source="M10-external-capabilities/impl/skill_source.py",
        observe=(
            "sync_skills() 怎样把文件系统里的 Skill 投影进内核 home",
            "tools/list 与 tools/call 的进程内协议往返",
            "M10.d：注入格式约定前后，同一问题的真实作答对照",
        ),
        takeaway="数据改变作答；宿主平面（webhook/upload）不在编排层。",
        next_="继续 M12，看 effect 栈怎样提供 LIFO 可逆回收。",
    ),
    Lesson(
        id="M12",
        title="框架机制本体",
        goal="直接观察 effect 栈的 LIFO、幂等与身份安全回收",
        entry="M12-framework-mechanisms/run.py",
        source="M12-framework-mechanisms/scenes/01_dispose_lifo.py",
        observe=(
            "后装先拆、重复 dispose 不重复执行、已释放栈拒绝新 effect",
            "同名注册时旧 disposer 为什么不会删掉新值",
            "配置分层：装配默认值 + 调用点覆盖 + extra 各层互不覆写",
        ),
        takeaway="LIFO 可逆回收与注册表纪律是所有 iota 扩展的底座。",
        next_="回到 README，按方向选择其余模块；对照表见 docs/dsh-vs-iota.md。",
    ),
)

LESSON_BY_ID = {lesson.id: lesson for lesson in LESSONS}
TOUR = ("M01", "M02", "M03")


def print_usage() -> None:
    print(
        "用法：\n"
        "  uv run python -m runtime.learn                 交互选择（终端中使用）\n"
        "  uv run python -m runtime.learn --tour          运行 M01 → M02 → M03\n"
        "  uv run python -m runtime.learn --list          列出精选入口\n"
        "  uv run python -m runtime.learn --module M01     运行一个模块\n"
    )


def print_lessons() -> None:
    print("精选学习入口：")
    for lesson in LESSONS:
        print(f"  {lesson.id}  {lesson.title} —— {lesson.goal}")
    print("\n全部 12 个模块可直接 uv run python -m runtime.runner M01 … M12。")
    print("每课自学教材见 lessons/（00 环境课 + 01–12 每模块一课）。")


def print_before(lesson: Lesson, current: int | None = None, total: int | None = None) -> None:
    progress = f"（{current}/{total}）" if current and total else ""
    print(
        f"\n{'═' * 64}\n▶ {lesson.id} · {lesson.title}{progress}\n"
        f"目标：{lesson.goal}\n运行时请观察："
    )
    for index, item in enumerate(lesson.observe, start=1):
        print(f"  {index}. {item}")
    print(f"{'─' * 64}\n")


def print_after(lesson: Lesson) -> None:
    print(
        f"\n✅ 你刚验证了：{lesson.takeaway}\n"
        f"   看实现：{lesson.source}\n"
        f"   下一步：{lesson.next_}"
    )


def run_lesson(lesson: Lesson, current: int | None = None, total: int | None = None) -> None:
    print_before(lesson, current, total)
    completed = subprocess.run(
        [sys.executable, lesson.entry],
        cwd=ROOT,
        env=os.environ,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"{lesson.id} 运行失败（code={completed.returncode}）")
    print_after(lesson)


def run_tour() -> None:
    print("iota 方向学习路线：工具管线 → 上下文 → 推理服务")
    for index, module_id in enumerate(TOUR, start=1):
        run_lesson(LESSON_BY_ID[module_id], index, len(TOUR))
    print("\n🎉 路线完成。使用 --list 选择循环干预、外部能力或框架机制继续。")


def interactive() -> None:
    print("iota 方向选择器\n  1. 路线：工具管线 → 上下文 → 推理服务")
    for index, lesson in enumerate(LESSONS, start=2):
        print(f"  {index}. {lesson.title}（{lesson.id}）")
    answer = input("\n输入序号：").strip()
    try:
        choice = int(answer)
    except ValueError as exc:
        raise SystemExit(f"无效选项：{answer or '空输入'}") from exc
    if choice == 1:
        run_tour()
        return
    if not 2 <= choice <= len(LESSONS) + 1:
        raise SystemExit(f"无效选项：{answer}")
    run_lesson(LESSONS[choice - 2])


def main() -> int:
    parser = argparse.ArgumentParser(description="iota-example 精选学习入口")
    parser.add_argument("--list", action="store_true", help="列出精选入口")
    parser.add_argument("--tour", action="store_true", help="运行 M01 → M02 → M03 学习路线")
    parser.add_argument("--module", help="运行一个精选模块，例如 M01")
    args = parser.parse_args()
    if args.list:
        print_lessons()
        return 0
    if args.tour:
        run_tour()
        return 0
    requested = (args.module or "").upper()
    if requested:
        lesson = LESSON_BY_ID.get(requested)
        if lesson is None:
            raise SystemExit(
                f"选择器未收录 {requested}；全部模块仍可直接 "
                f"uv run python -m runtime.runner {requested}"
            )
        run_lesson(lesson)
        return 0
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print_lessons()
        print("\n当前不是交互终端；请使用 --tour 或 --module MXX。")
        return 0
    interactive()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
