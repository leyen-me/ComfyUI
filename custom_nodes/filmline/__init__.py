"""ComfyUI 自定义节点入口：加载 filmline 包并注册路由。

ComfyUI 的 custom node 加载器用 ``spec_from_file_location`` 直接执行本文件，
模块名是“路径字符串”，因此本文件不是常规包，**不能使用相对导入**。

同时，本目录刻意不往 ``sys.path`` 里塞路径：常见的第三方自定义节点
会把若干通用名模块（llm/compose/config）放进 sys.path，任何同名模块
都可能被意外遮蔽。这里显式构造包 spec，模块名唯一且不污染全局搜索路径。
"""

from __future__ import annotations

import importlib.util
import logging
import os
import sys

_PKG_NAME = "filmline"
_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_DIR = os.path.join(_HERE, "src", _PKG_NAME)

_LOG = logging.getLogger("filmline")


def _load_package():
    existing = sys.modules.get(_PKG_NAME)
    if existing is not None:
        return existing

    init_file = os.path.join(_PKG_DIR, "__init__.py")
    spec = importlib.util.spec_from_file_location(
        _PKG_NAME,
        init_file,
        submodule_search_locations=[_PKG_DIR],
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"无法构造 {_PKG_NAME} 包描述符: {init_file}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[_PKG_NAME] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(_PKG_NAME, None)
        raise
    return module


_pkg = _load_package()

try:
    _pkg.attach_to_prompt_server()
except Exception:  # 路由注册失败不应拖垮整个 ComfyUI 启动
    _LOG.exception("filmline 路由注册失败，相关接口不可用")

# HTTP 服务为主；节点仅提供生成流程需要的辅助能力（如任意尺寸空 latent）。
NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = _pkg.node_class_mappings()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
