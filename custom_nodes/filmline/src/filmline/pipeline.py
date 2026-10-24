"""把 ComfyUI 产物登记为 Filmline 资产。

生成接口改为后台任务后，HTTP 请求只负责创建任务；这里由 runner 在任务完成后
统一落盘和写库，避免客户端刷新导致产物丢失。
"""

from __future__ import annotations

import logging
from datetime import datetime

from . import storage
from .domain.assets import AssetService
from .domain.schemas import AssetKind, AssetSource
from .generation import Product

_LOG = logging.getLogger("filmline")


def register_products(
    *,
    project_id: int,
    episode_id: int | None,
    scope: str,
    kind: str,
    meta: dict,
    products: list[Product],
    elapsed_seconds: float,
    gen_started_at: datetime | None,
    queue_ms: int = 0,
) -> list[int]:
    service = AssetService()
    created: list[int] = []

    for product in products:
        relative, target = storage.allocate(project_id, scope, product.suffix)
        target.write_bytes(product.data)

        item_meta = dict(meta)
        item_meta["queue_ms"] = max(0, int(queue_ms))
        if kind == "image":
            try:
                from PIL import Image

                with Image.open(target) as produced:
                    from .generation import ratio_label

                    item_meta["width"], item_meta["height"] = produced.width, produced.height
                    item_meta["size"] = ratio_label(produced.width, produced.height)
            except Exception:
                _LOG.warning("无法读取产物尺寸: %s", target)

        asset = service.create_from_file(
            project_id,
            name=product.filename,
            kind=AssetKind(kind),
            source=AssetSource.ai,
            relative_path=relative,
            mime_type=storage.MIME_BY_SUFFIX.get(
                product.suffix.lower(), "application/octet-stream"
            ),
            size_bytes=len(product.data),
            episode_id=episode_id,
            meta=item_meta,
            gen_started_at=gen_started_at,
            gen_elapsed_ms=int(elapsed_seconds * 1000),
        )
        created.append(asset.id)

    return created
