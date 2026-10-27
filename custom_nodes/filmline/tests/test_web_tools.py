"""外部工具：端点拼接、URL 校验、结果截断与错误映射。"""

from __future__ import annotations

import unittest
from unittest import mock

import base  # noqa: F401  (把 src 加入 sys.path)
from filmline.agent.tools import ToolContext
from filmline.agent.tools import web


def _ctx() -> ToolContext:
    return ToolContext(
        session_id=1,
        project_id=1,
        project_code="PRJ-0001",
        project_name="测试",
    )


class WebHelpersTest(unittest.TestCase):
    def test_endpoint_handles_v1_base(self) -> None:
        self.assertEqual(
            web.tool_endpoint("https://api.deepseek.com", "/tools/search"),
            "https://api.deepseek.com/v1/tools/search",
        )
        self.assertEqual(
            web.tool_endpoint("https://api.deepseek.com/v1/", "/tools/fetch"),
            "https://api.deepseek.com/v1/tools/fetch",
        )

    def test_fetch_url_validation(self) -> None:
        self.assertEqual(web.validate_fetch_url("https://example.com/a"), "https://example.com/a")
        for bad in (
            "ftp://example.com/a",
            "https:///a",
            "https://user:pass@example.com/a",
            "file:///etc/passwd",
        ):
            with self.subTest(url=bad), self.assertRaises(web.WebError):
                web.validate_fetch_url(bad)

    def test_result_shaping_truncates_content_budget(self) -> None:
        results = [
            {
                "title": f"t{i}",
                "url": f"https://example.com/{i}",
                "snippet": "s",
                "summary": "m",
                "content": "x" * 10_000,
            }
            for i in range(10)
        ]
        shaped, truncated = web._shape_results(results, need_content=True)
        self.assertTrue(truncated)
        self.assertEqual(len(shaped), 10)
        total = sum(len(item["content"]) for item in shaped)
        self.assertLessEqual(total, web.CONTENT_BUDGET + 100)
        self.assertTrue(shaped[0]["content"])

    def test_status_messages(self) -> None:
        self.assertEqual(web._status_message(402, fetch=False)[0], "insufficient_balance")
        self.assertEqual(web._status_message(404, fetch=True)[0], "not_found")
        self.assertEqual(web._status_message(429, fetch=False)[0], "rate_limited")
        self.assertEqual(web._status_message(503, fetch=True)[0], "upstream")


class WebToolsTest(unittest.IsolatedAsyncioTestCase):
    async def test_search_returns_shaped_results(self) -> None:
        payload = {
            "results": [
                {
                    "title": "DeepSeek 文档",
                    "url": "https://api-docs.deepseek.com",
                    "snippet": "snippet",
                    "summary": "summary",
                    "content": "正文",
                    "site_name": "DeepSeek",
                    "date": "2026-01-01T00:00:00+00:00",
                    "authority": 4,
                    "rerank_score": 2.6,
                }
            ]
        }
        with mock.patch.object(web, "_post_json", mock.AsyncMock(return_value=payload)):
            outcome = await web._web_search(
                _ctx(), {"query": "DeepSeek", "count": 3, "need_content": True}
            )
        self.assertTrue(outcome.ok)
        self.assertIn("1 条结果", outcome.summary)
        self.assertEqual(outcome.data["results"][0]["authority"], 4)
        self.assertEqual(outcome.data["results"][0]["content"], "正文")
        self.assertTrue(outcome.meta["untrusted"])

    async def test_fetch_truncates_long_content(self) -> None:
        payload = {"title": "长文", "content": "字" * (web.MAX_FETCH_CONTENT + 100)}
        with mock.patch.object(web, "_post_json", mock.AsyncMock(return_value=payload)):
            outcome = await web._web_fetch(_ctx(), {"url": "https://example.com/long"})
        self.assertTrue(outcome.ok)
        self.assertTrue(outcome.data["truncated"])
        self.assertEqual(outcome.data["chars"], web.MAX_FETCH_CONTENT + 100)
        self.assertLessEqual(len(outcome.data["content"]), web.MAX_FETCH_CONTENT + len("\n…[内容已截断]"))

    async def test_fetch_rejects_bad_url_without_network(self) -> None:
        with mock.patch.object(web, "_post_json", mock.AsyncMock()) as mocked:
            outcome = await web._web_fetch(_ctx(), {"url": "ftp://example.com/a"})
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.error["code"], "invalid_url")
        mocked.assert_not_awaited()

    async def test_error_is_returned_as_tool_result(self) -> None:
        with mock.patch.object(
            web, "_post_json", mock.AsyncMock(side_effect=web.WebError("频率限制", code="rate_limited"))
        ):
            outcome = await web._web_search(_ctx(), {"query": "x"})
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.error["code"], "rate_limited")

    async def test_search_bad_payload(self) -> None:
        with mock.patch.object(web, "_post_json", mock.AsyncMock(return_value={"results": "no"})):
            outcome = await web._web_search(_ctx(), {"query": "x"})
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.error["code"], "bad_response")
