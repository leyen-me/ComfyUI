"""HTTP 层测试：走真实的 aiohttp 路由，验证状态码与响应信封。"""

from __future__ import annotations

from base import ApiTestCase


class ProjectApiTest(ApiTestCase):
    async def _create(self, name="测试项目", **extra):
        res = await self.client.post("/studio/api/projects", json={"name": name, **extra})
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        return body["data"]

    async def test_health(self) -> None:
        res = await self.client.get("/studio/api/health")
        body = await res.json()
        self.assertEqual(res.status, 200)
        self.assertTrue(body["ok"])
        self.assertIn("schema_version", body["data"])

    async def test_create_generates_code(self) -> None:
        project = await self._create("长安十二时辰")
        self.assertEqual(project["code"], "PRJ-0001")
        self.assertNotIn("status", project)

        res = await self.client.get("/studio/api/projects?q=长安")
        body = await res.json()
        self.assertEqual(body["data"]["total"], 1)
        self.assertEqual(body["data"]["items"][0]["id"], project["id"])

    async def test_client_cannot_choose_code(self) -> None:
        res = await self.client.post("/studio/api/projects", json={"name": "甲", "code": "MY-CODE"})
        self.assertEqual(res.status, 400)

    async def test_create_validation_error_envelope(self) -> None:
        res = await self.client.post("/studio/api/projects", json={"name": ""})
        body = await res.json()
        self.assertEqual(res.status, 400)
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "invalid_argument")
        self.assertTrue(body["error"]["details"])

    async def test_unknown_field_rejected(self) -> None:
        res = await self.client.post("/studio/api/projects", json={"name": "甲", "evil": 1})
        self.assertEqual(res.status, 400)

    async def test_malformed_json_rejected(self) -> None:
        res = await self.client.post(
            "/studio/api/projects", data="{不是 json", headers={"Content-Type": "application/json"}
        )
        body = await res.json()
        self.assertEqual(res.status, 400)
        self.assertEqual(body["error"]["code"], "invalid_argument")

    async def test_update_and_delete_flow(self) -> None:
        project = await self._create("甲")
        ref = project["code"]

        res = await self.client.patch(f"/studio/api/projects/{ref}", json={"name": "乙"})
        body = await res.json()
        self.assertEqual(res.status, 200)
        self.assertEqual(body["data"]["name"], "乙")

        res = await self.client.delete(f"/studio/api/projects/{ref}")
        self.assertEqual(res.status, 204)

        res = await self.client.get(f"/studio/api/projects/{ref}")
        body = await res.json()
        self.assertEqual(res.status, 404)
        self.assertEqual(body["error"]["code"], "not_found")

    async def test_bad_query_param(self) -> None:
        res = await self.client.get("/studio/api/projects?limit=abc")
        self.assertEqual(res.status, 400)

    async def test_reorder_endpoint(self) -> None:
        first = await self._create("甲")
        second = await self._create("乙")

        res = await self.client.put(
            "/studio/api/projects/order", json={"ids": [second["id"], first["id"]]}
        )
        self.assertEqual(res.status, 204)

        body = await (await self.client.get("/studio/api/projects")).json()
        self.assertEqual([item["name"] for item in body["data"]["items"]], ["乙", "甲"])

    async def test_reorder_rejects_partial_list(self) -> None:
        first = await self._create("甲")
        await self._create("乙")
        res = await self.client.put("/studio/api/projects/order", json={"ids": [first["id"]]})
        self.assertEqual(res.status, 400)

    async def test_spa_fallback_for_detail_route(self) -> None:
        project = await self._create("甲")
        res = await self.client.get(f"/studio/projects/{project['code']}")
        self.assertEqual(res.status, 200)
        self.assertIn("text/html", res.headers["Content-Type"])

    async def test_unknown_api_path_is_not_html(self) -> None:
        res = await self.client.get("/studio/api/nope")
        self.assertEqual(res.status, 404)

    async def test_index_page_served(self) -> None:
        res = await self.client.get("/studio")
        self.assertEqual(res.status, 200)
        self.assertIn("text/html", res.headers["Content-Type"])


if __name__ == "__main__":
    unittest.main()
