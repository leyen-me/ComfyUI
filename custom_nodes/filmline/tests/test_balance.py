"""余额代理：URL、归一化、缓存与未配置状态。"""

from __future__ import annotations

import unittest
from unittest import mock

import base  # noqa: F401
from filmline.agent import balance
from filmline.config import AgentSettings


def _settings(**overrides) -> AgentSettings:
    values = dict(
        api_key="test-key",
        base_url="https://api.deepseek.com",
        model="deepseek-flash",
        thinking="auto",
        reasoning_effort="high",
        context_window=1_000_000,
        max_tokens=8192,
        timeout=300,
        tick_seconds=300,
    )
    values.update(overrides)
    return AgentSettings(**values)


class BalanceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        balance._cache.clear()

    def test_balance_url_handles_v1(self) -> None:
        self.assertEqual(
            balance.balance_url("https://api.deepseek.com"), "https://api.deepseek.com/user/balance"
        )
        self.assertEqual(
            balance.balance_url("https://api.deepseek.com/v1/"),
            "https://api.deepseek.com/user/balance",
        )

    def test_normalize(self) -> None:
        result = balance._normalize(
            {
                "is_available": True,
                "balance_infos": [
                    {
                        "currency": "CNY",
                        "total_balance": "42.31",
                        "granted_balance": "2.31",
                        "topped_up_balance": "40.00",
                    },
                    {"currency": "EUR", "total_balance": "1"},
                ],
            }
        )
        self.assertTrue(result["available"])
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["total"], "42.31")
        self.assertEqual(result["items"][0]["topped_up"], "40.00")

    async def test_unconfigured_does_not_call_network(self) -> None:
        with mock.patch.object(balance, "_get", mock.AsyncMock()) as mocked:
            result = await balance.fetch_balance(_settings(api_key=""))
        self.assertFalse(result["configured"])
        self.assertEqual(result["items"], [])
        mocked.assert_not_awaited()

    async def test_success_is_cached_and_force_refresh(self) -> None:
        payload = {
            "is_available": True,
            "balance_infos": [
                {
                    "currency": "CNY",
                    "total_balance": "10.00",
                    "granted_balance": "0",
                    "topped_up_balance": "10.00",
                }
            ],
        }
        getter = mock.AsyncMock(return_value=payload)
        with mock.patch.object(balance, "_get", getter):
            first = await balance.fetch_balance(_settings())
            second = await balance.fetch_balance(_settings())
            third = await balance.fetch_balance(_settings(), force=True)
        self.assertEqual(first["items"][0]["total"], "10.00")
        self.assertEqual(second["items"][0]["total"], "10.00")
        self.assertEqual(third["items"][0]["total"], "10.00")
        self.assertEqual(getter.await_count, 2)

    async def test_unavailable_account(self) -> None:
        payload = {"is_available": False, "balance_infos": []}
        with mock.patch.object(balance, "_get", mock.AsyncMock(return_value=payload)):
            result = await balance.fetch_balance(_settings())
        self.assertFalse(result["available"])
        self.assertEqual(result["items"], [])
        self.assertTrue(result["configured"])
