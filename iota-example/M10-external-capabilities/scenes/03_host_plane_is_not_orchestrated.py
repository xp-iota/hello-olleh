"""Host plane 边界：webhook、上传、UI 这类宿主能力在编排层没有注册面。"""

from __future__ import annotations

from typing import Any

from iota_core.registry import Registry

from runtime.harness import WorkshopHarness, require

HOST_WORDS = ("webhook", "upload", "http", "server", "desktop", "web")


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    facets = sorted(vars(Registry()))
    host_surface = sorted(name for name in facets if any(word in name for word in HOST_WORDS))
    require(host_surface == [], "编排层没有 Host plane 注册面", host_surface)
    return {
        "registry_facets": facets,
        "host_surface": host_surface,
        "host_plane_owner": "host application",
    }
