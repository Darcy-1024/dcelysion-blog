import assert from "node:assert/strict";
import { createDecipheriv, pbkdf2Sync, webcrypto } from "node:crypto";
import test from "node:test";
import { encryptContent } from "./crypto-utils.js";

// Decode the published envelope with independent consumers, including the
// WebCrypto API used by EncryptedContent. No real content or passwords are used.
function decryptNode(encoded: string, password: string): string {
	const raw = Buffer.from(encoded, "base64");
	const key = pbkdf2Sync(password, raw.subarray(0, 16), 100000, 32, "sha256");
	const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(16, 28));
	decipher.setAuthTag(raw.subarray(28, 44));
	return Buffer.concat([
		decipher.update(raw.subarray(44)),
		decipher.final(),
	]).toString("utf8");
}

async function decryptWeb(encoded: string, password: string): Promise<string> {
	const raw = Uint8Array.from(Buffer.from(encoded, "base64"));
	const material = await webcrypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	const key = await webcrypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: raw.slice(0, 16),
			iterations: 100000,
			hash: "SHA-256",
		},
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["decrypt"],
	);
	// WebCrypto expects ciphertext + tag, whereas the envelope stores tag first.
	const combined = new Uint8Array(raw.length - 28);
	combined.set(raw.slice(44));
	combined.set(raw.slice(28, 44), raw.length - 44);
	return new TextDecoder().decode(
		await webcrypto.subtle.decrypt(
			{ name: "AES-GCM", iv: raw.slice(16, 28) },
			key,
			combined,
		),
	);
}

test("same password, slug and HTML receive fresh salt and IV and remain decryptable", async () => {
	const html = "<p>合成正文，标点！🙂</p>\n<div>second line</div>";
	const password = "synthetic-password";
	const first = encryptContent(html, password, "fixture");
	const second = encryptContent(html, password, "fixture");
	const a = Buffer.from(first, "base64");
	const b = Buffer.from(second, "base64");
	assert.equal(a.length, 44 + Buffer.byteLength(html));
	assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16));
	assert.notDeepEqual(a.subarray(16, 28), b.subarray(16, 28));
	for (const encoded of [first, second]) {
		assert.equal(decryptNode(encoded, password), html);
		assert.equal(await decryptWeb(encoded, password), html);
	}
	assert.equal(
		await decryptWeb(encryptContent("", password, "empty"), password),
		"",
	);
});

test("wrong passwords and altered envelope fields fail authentication", async () => {
	const encoded = encryptContent("synthetic content", "correct", "fixture");
	assert.throws(() => decryptNode(encoded, "wrong"));
	await assert.rejects(decryptWeb(encoded, "wrong"));
	for (const offset of [0, 16, 28, 44]) {
		const tampered = Buffer.from(encoded, "base64");
		tampered[offset] ^= 1;
		const altered = tampered.toString("base64");
		assert.throws(() => decryptNode(altered, "correct"));
		await assert.rejects(decryptWeb(altered, "correct"));
	}
});
