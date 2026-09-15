"""凭证来源：只从环境/.env 读，装配报告里不带凭证本体。"""

from __future__ import annotations

from typing import Any

from runtime.harness import CONFIG_VARIABLES, WorkshopHarness, redact, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    report = dict(harness.preflight_report)
    leaked = sorted(key for key in report if "token" in key.lower() or "key" in key.lower())
    require(leaked == [], "装配报告里没有凭证字段", leaked)
    require("LLM_API_KEY" in CONFIG_VARIABLES, "凭证是声明过的配置项", CONFIG_VARIABLES)
    require(redact("token=abc") == "token=abc", "脱敏只作用于真实凭证与端点")
    return {
        "config_variables": list(CONFIG_VARIABLES),
        "report_keys": sorted(report),
        "leaked_fields": leaked,
        "credential_owner": "host environment",
    }
