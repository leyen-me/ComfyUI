"""工具入参的 JSON Schema 校验。

只实现工具真正用到的子集：object / array / string / integer / number /
boolean / null、required、additionalProperties=false、enum、range、长度。
未知关键字一律忽略，避免和模型生成的 schema 产生无意义冲突。
"""

from __future__ import annotations

from typing import Any


class SchemaError(ValueError):
    def __init__(self, path: str, message: str) -> None:
        super().__init__(f"{path or '输入'}: {message}")
        self.path = path
        self.message = message


def _type_of(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "unknown"


def _matches(value: Any, expected: str) -> bool:
    actual = _type_of(value)
    if expected == "number":
        return actual in ("number", "integer")
    return actual == expected


def validate(value: Any, schema: dict[str, Any], path: str = "") -> Any:
    expected = schema.get("type")
    if expected and not _matches(value, expected):
        raise SchemaError(path, f"应为 {expected}，收到 {_type_of(value)}")

    if "enum" in schema and value not in schema["enum"]:
        raise SchemaError(path, f"只能是 {' / '.join(map(str, schema['enum']))}")

    if expected == "string":
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        if minimum is not None and len(value) < minimum:
            raise SchemaError(path, f"至少 {minimum} 个字符")
        if maximum is not None and len(value) > maximum:
            raise SchemaError(path, f"最多 {maximum} 个字符")

    if expected in ("integer", "number"):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if minimum is not None and value < minimum:
            raise SchemaError(path, f"不能小于 {minimum}")
        if maximum is not None and value > maximum:
            raise SchemaError(path, f"不能大于 {maximum}")

    if expected == "object":
        properties = schema.get("properties") or {}
        for name in schema.get("required") or []:
            if name not in value:
                raise SchemaError(f"{path}.{name}" if path else name, "必填")
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(properties))
            if extra:
                raise SchemaError(path, f"不支持的字段: {', '.join(extra)}")
        cleaned: dict[str, Any] = {}
        for name, child in properties.items():
            if name in value:
                child_path = f"{path}.{name}" if path else name
                cleaned[name] = validate(value[name], child, child_path)
            elif "default" in child:
                cleaned[name] = child["default"]
        for name, item in value.items():
            if name not in properties and schema.get("additionalProperties") is not False:
                cleaned[name] = item
        return cleaned

    if expected == "array":
        items = schema.get("items")
        maximum = schema.get("maxItems")
        if maximum is not None and len(value) > maximum:
            raise SchemaError(path, f"最多 {maximum} 项")
        minimum = schema.get("minItems")
        if minimum is not None and len(value) < minimum:
            raise SchemaError(path, f"至少 {minimum} 项")
        if isinstance(items, dict):
            return [
                validate(item, items, f"{path}[{index}]") for index, item in enumerate(value)
            ]
        return list(value)

    return value
