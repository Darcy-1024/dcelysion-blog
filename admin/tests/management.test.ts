import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { readConfig } from "../server/config.js";
import type { Thread, User } from "../shared/management.js";
import { listenLocal } from "./local-listener.js";
import { managementFixture } from "./management-fixture.js";

async function setup() {
	const f = await managementFixture();
	const server = createServer(
		(req, res) =>
			void f.api(req, res, new URL(req.url || "/", f.config.origin)),
	);
	const address = await listenLocal(server);
	assert.ok(address && typeof address !== "string");
	f.config.origin = `http://127.0.0.1:${address.port}`;
	let cookie = "";
	const call = async (
		path: string,
		input?: Record<string, unknown>,
		origin = f.config.origin,
	) => {
		const response = await fetch(f.config.origin + path, {
			headers: { cookie, origin, "content-type": "application/json" },
			...(input ? { method: "POST", body: JSON.stringify(input) } : {}),
		});
		const json = await response.json();
		return { response, json };
	};
	const login = async (password = "preview") => {
		const { response, json } = await call("/api/login", {
			identity: "preview",
			password,
			code: "123456",
		});
		assert.equal(json.ok, true);
		cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
		return cookie;
	};
	const close = async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await f.db.close();
	};
	return { ...f, call, login, close };
}
test("management adapter/API: filters, exact threads, edits/status/replies/cascade and users", async () => {
	const f = await setup();
	try {
		await f.login();
		const list = await f.call(
			"/api/manage/comments?path=%2Fposts%2Fexample%2F&status=waiting&pageSize=1",
		);
		assert.equal(list.json.data.total, 1);
		assert.equal(list.json.data.pages, 1);
		assert.equal(list.json.data.items[0].objectId, "1");
		assert.equal(list.json.data.items[0].article, "原标题");
		const all = await f.call("/api/manage/comments?search=评论&pageSize=1");
		assert.equal(all.json.data.total, 1);
		let thread = (await f.call("/api/manage/comments/1")).json.data as Thread;
		assert.deepEqual(
			thread.thread.map((row) => row.objectId),
			["1", "2"],
		);
		assert.equal(thread.deleteCount, 2);
		for (const status of ["approved", "spam", "waiting"]) {
			const result = await f.call("/api/manage/comments/1/status", {
				requestId: randomUUID(),
				fingerprint: thread.item.fingerprint,
				status,
			});
			assert.equal(result.json.ok, true);
			thread = (await f.call("/api/manage/comments/1")).json.data;
			assert.equal(thread.item.status, status);
		}
		const body = "  编辑正文！🙂\n\n末尾  ";
		assert.equal(
			(
				await f.call("/api/manage/comments/1/edit", {
					requestId: randomUUID(),
					fingerprint: thread.item.fingerprint,
					comment: body,
				})
			).json.ok,
			true,
		);
		thread = (await f.call("/api/manage/comments/1")).json.data;
		assert.equal(thread.item.comment, body);
		const reply = "回复原文！🙂  ";
		assert.equal(
			(
				await f.call("/api/manage/comments/1/reply", {
					requestId: randomUUID(),
					fingerprint: thread.item.fingerprint,
					comment: reply,
				})
			).json.ok,
			true,
		);
		const posted = [...f.requests]
			.reverse()
			.find((row) => row.path === "/api/comment" && row.method === "POST");
		assert.deepEqual(posted?.input, {
			comment: reply,
			url: "/posts/example/",
			pid: "1",
			rid: "1",
			nick: "隔离模拟管理员",
			mail: "owner@example.invalid",
			link: "https://example.invalid",
			ua: "DcElysion Admin",
		});
		assert.equal(
			(await f.call("/api/manage/comments?userId=8")).json.data.total,
			2,
		);
		const users = (await f.call("/api/manage/users?search=普通")).json.data;
		assert.equal(users.total, 1);
		const target = users.items[0] as User;
		assert.equal(JSON.stringify(target).includes("secret"), false);
		assert.equal(
			(
				await f.call("/api/manage/users/8/state", {
					requestId: randomUUID(),
					fingerprint: target.fingerprint,
					type: "banned",
				})
			).json.ok,
			true,
		);
		assert.equal(f.users[1].auth_version, 1);
		thread = (await f.call("/api/manage/comments/1")).json.data;
		assert.equal(thread.deleteCount, 3);
		assert.equal(
			(
				await f.call("/api/manage/comments/1/delete", {
					requestId: randomUUID(),
					fingerprint: thread.item.fingerprint,
				})
			).json.ok,
			true,
		);
		assert.deepEqual(
			f.comments.map((row) => row.objectId),
			[3],
		);
		assert.equal(
			(await f.call("/api/manage/comments?path=%2Funknown%2Fhistorical%2F"))
				.json.data.total,
			1,
		);
		await writeFile(
			join(f.root, "src/content/dynamic/2026-09-30-120000.md"),
			"---\npublished: 2026-09-30\nslug: custom-dynamic\n---\n\n自定义动态路径",
		);
		f.comments[0].url = "/dynamic/custom-dynamic/";
		assert.equal(
			(await f.call("/api/manage/comments?path=%2Fdynamic%2Fcustom-dynamic%2F"))
				.json.data.items[0].article,
			"自定义动态路径",
		);
		const audits = await f.db.query<{
			action: string;
			object_id: string;
			request_id: string;
		}>(
			"SELECT action,object_id,request_id FROM dc_admin.audit WHERE object_id IS NOT NULL",
		);
		assert.ok(audits.rows.length >= 7);
		assert.ok(audits.rows.every((row) => row.request_id && row.object_id));
	} finally {
		await f.close();
	}
});
test("management boundaries: auth/origin/conflict/DTOs/unknown writes/protected owner/password/session revocation", async () => {
	const f = await setup();
	try {
		assert.equal((await f.call("/api/manage/comments")).response.status, 401);
		await f.login();
		assert.equal(
			(await f.call("/api/manage/comments/1/delete", {}, "http://evil.invalid"))
				.response.status,
			403,
		);
		assert.equal(
			(await f.call("/api/manage/comments?upstream=https://evil.invalid"))
				.response.status,
			400,
		);
		const thread = (await f.call("/api/manage/comments/1")).json.data as Thread;
		assert.ok(thread.item.comment.includes("<script>")); // DTO plain text; browser checks escaping.
		const profile = (await f.call("/api/manage/account")).json.data;
		assert.equal(f.config.walineSecurityUrl, "");
		assert.equal(
			readConfig({
				ADMIN_ALLOW_INSECURE_LOCAL: "1",
				ADMIN_WALINE_SECURITY_URL:
					"https://comments.example.invalid/ui/profile",
			}).walineSecurityUrl,
			"https://comments.example.invalid/ui/profile",
		);
		assert.throws(() =>
			readConfig({
				ADMIN_ALLOW_INSECURE_LOCAL: "1",
				ADMIN_WALINE_SECURITY_URL: "javascript:alert(1)",
			}),
		);
		assert.throws(() =>
			readConfig({
				ADMIN_ALLOW_INSECURE_LOCAL: "1",
				ADMIN_WALINE_SECURITY_URL:
					"https://comments.example.invalid/ui/profile?token=bad",
			}),
		);
		assert.equal(profile.twoFactorEnabled, true);
		assert.equal(JSON.stringify(profile).includes("SECRET"), false);
		assert.equal(
			(
				await f.call("/api/manage/account/profile", {
					requestId: randomUUID(),
					fingerprint: profile.fingerprint,
					display_name: "新昵称",
					url: "javascript:alert(1)",
				})
			).response.status,
			400,
		);
		assert.equal(
			(
				await f.call("/api/manage/comments/1/edit", {
					requestId: randomUUID(),
					fingerprint: thread.item.fingerprint,
					comment: "try",
					user_id: 7,
				})
			).response.status,
			400,
		);
		f.comments[0].comment = "另一个编辑器改动";
		assert.equal(
			(
				await f.call("/api/manage/comments/1/edit", {
					requestId: randomUUID(),
					fingerprint: thread.item.fingerprint,
					comment: "try",
				})
			).json.error.code,
			"MANAGEMENT_CONFLICT",
		);
		const owner = (await f.call("/api/manage/users/7")).json.data;
		assert.equal(
			(
				await f.call("/api/manage/users/7/state", {
					requestId: randomUUID(),
					fingerprint: owner.fingerprint,
					type: "banned",
				})
			).json.error.code,
			"OWNER_PROTECTED",
		);
		f.setFault("403");
		assert.equal(
			(await f.call("/api/manage/comments")).json.error.code,
			"WALINE_FORBIDDEN",
		);
		f.setFault("read-timeout");
		assert.equal(
			(await f.call("/api/manage/comments")).json.error.code,
			"WALINE_TIMEOUT",
		);
		f.setFault("");
		const current = (await f.call("/api/manage/comments/1")).json
			.data as Thread;
		const operation = {
			requestId: randomUUID(),
			fingerprint: current.item.fingerprint,
			comment: "可能已发出的回复",
		};
		f.setFault("write-timeout");
		assert.equal(
			(await f.call("/api/manage/comments/1/reply", operation)).json.error.code,
			"WRITE_UNKNOWN",
		);
		f.setFault("");
		assert.equal(
			(await f.call("/api/manage/comments/1/reply", operation)).json.error.code,
			"WRITE_UNKNOWN",
		);
		assert.equal(
			f.requests.filter(
				(row) => row.method === "POST" && row.path === "/api/comment",
			).length,
			1,
		);
		f.setFault("write-500");
		assert.equal(
			(
				await f.call("/api/manage/comments/3/edit", {
					requestId: randomUUID(),
					fingerprint: (
						await f.call("/api/manage/comments/3")
					).json.data.item.fingerprint,
					comment: "500后可能已保存",
				})
			).json.error.code,
			"WRITE_UNKNOWN",
		);
		f.setFault("");
		const list = (await f.call("/api/manage/sessions")).json.data;
		assert.equal(list.length, 1);
		assert.equal(list[0].current, true);
		assert.equal(JSON.stringify(list).includes("token"), false);
		await f.call("/api/manage/sessions/revoke", { id: list[0].id });
		assert.equal((await f.call("/api/manage/comments")).response.status, 401);
		await f.login();
		const second = await f.auth.login("preview", "preview", "123456");
		assert.ok(second);
		assert.equal(
			(
				await f.call("/api/manage/account/password", {
					requestId: randomUUID(),
					currentPassword: "wrong",
					password: "new-password",
					code: "123456",
				})
			).json.error.code,
			"WALINE_REJECTED",
		);
		assert.equal(
			(
				await f.call("/api/manage/account/password", {
					requestId: randomUUID(),
					currentPassword: "preview",
					password: "new-password",
					code: "bad",
				})
			).json.error.code,
			"WALINE_REJECTED",
		);
		const result = await f.call("/api/manage/account/password", {
			requestId: randomUUID(),
			currentPassword: "preview",
			password: "new-password",
			code: "123456",
		});
		assert.equal(result.json.data.signedOut, true);
		assert.equal(await f.auth.verify(second.token), null);
		assert.equal((await f.call("/api/me")).response.status, 401);
		await f.login("new-password");
		f.setFault("401");
		assert.equal(
			(await f.call("/api/manage/comments")).json.error.code,
			"WALINE_REAUTH",
		);
		f.setFault("");
		assert.equal((await f.call("/api/me")).response.status, 401);
	} finally {
		await f.close();
	}
});
