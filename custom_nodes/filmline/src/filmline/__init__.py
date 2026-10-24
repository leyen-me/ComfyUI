"""filmline —— 影视制片管线（挂载在 ComfyUI 之上的语义层）。

本包不修改 ComfyUI 任何源码，只通过其官方扩展点注册 HTTP 路由：
``/studio`` 提供前端，``/studio/api/*`` 提供业务接口。
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__", "attach_to_prompt_server", "node_class_mappings"]


def node_class_mappings() -> tuple[dict, dict]:
    """供 custom_nodes 入口取节点表（本扩展主要为 HTTP 服务，节点仅作辅助）。"""
    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

    return NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS


def attach_to_prompt_server() -> bool:
    """把路由挂到正在运行的 ComfyUI 上；不在其运行时安全返回 False。"""
    import logging

    log = logging.getLogger("filmline")
    try:
        from server import PromptServer  # type: ignore[import-not-found]
    except ImportError:
        log.warning("未找到 ComfyUI server 模块，跳过路由注册")
        return False

    instance = getattr(PromptServer, "instance", None)
    if instance is None:
        log.warning("ComfyUI PromptServer 尚未初始化，跳过路由注册")
        return False

    from .api.routes import register_routes

    register_routes(instance.app)
    log.info("filmline 已挂载: /studio, /studio/api/*")
    return True
