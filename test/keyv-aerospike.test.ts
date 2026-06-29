import Keyv from "keyv";
import { afterAll, describe, expect, it } from "vitest";
import { KeyvAerospike, createKeyv } from "../src/index.js";
import { aerospikeHosts } from "./helpers.js";

const makeStore = () => {
	const store = new KeyvAerospike({ hosts: aerospikeHosts });
	store.on("error", () => {});
	return store;
};

describe("KeyvAerospike v6 core", () => {
	const store = makeStore();
	afterAll(async () => {
		await store.disconnect();
	});

	it("declares the v6 expires capability", () => {
		expect(store.capabilities.expires).toBe(true);
	});

	it("sets and gets a value", async () => {
		await store.set("k1", "hello");
		expect(await store.get("k1")).toBe("hello");
	});

	it("returns undefined for a missing key", async () => {
		expect(await store.get("missing-key")).toBeUndefined();
	});

	it("stores objects via passthrough", async () => {
		const payload = { a: 1, b: "two" };
		await store.set("k2", payload);
		expect(await store.get("k2")).toEqual(payload);
	});

	it("has() reflects existence", async () => {
		await store.set("k3", "v");
		expect(await store.has("k3")).toBe(true);
		expect(await store.has("nope")).toBe(false);
	});

	it("delete returns true then false", async () => {
		await store.set("k4", "v");
		expect(await store.delete("k4")).toBe(true);
		expect(await store.delete("k4")).toBe(false);
	});
});

describe("KeyvAerospike v6 expiry (absolute expires, enforce on read)", () => {
	const store = makeStore();
	afterAll(async () => {
		await store.disconnect();
	});

	it("expires a key after an absolute deadline", async () => {
		await store.set("e1", "v", Date.now() + 1000);
		expect(await store.get("e1")).toBe("v");
		await new Promise((r) => setTimeout(r, 2500));
		expect(await store.get("e1")).toBeUndefined();
	});

	it("does not persist an already-elapsed deadline", async () => {
		await store.set("e2", "v", Date.now() - 1000);
		expect(await store.get("e2")).toBeUndefined();
	});

	it("has() returns false for an expired key", async () => {
		await store.set("e3", "v", Date.now() + 1000);
		await new Promise((r) => setTimeout(r, 2500));
		expect(await store.has("e3")).toBe(false);
	});
});

describe("KeyvAerospike v6 batch", () => {
	const store = makeStore();
	afterAll(async () => {
		await store.disconnect();
	});

	it("setMany returns boolean[] and stores all", async () => {
		const result = await store.setMany([
			{ key: "s1", value: "a" },
			{ key: "s2", value: "b" },
		]);
		expect(result).toEqual([true, true]);
		expect(await store.getMany(["s1", "s2"])).toEqual(["a", "b"]);
	});

	it("getMany preserves order with undefined for misses", async () => {
		await store.set("g1", "a");
		expect(await store.getMany(["g1", "absent"])).toEqual(["a", undefined]);
	});

	it("hasMany returns flags in order", async () => {
		await store.set("h1", "a");
		expect(await store.hasMany(["h1", "absent"])).toEqual([true, false]);
	});

	it("deleteMany returns per-key boolean[]", async () => {
		await store.setMany([
			{ key: "d1", value: "a" },
			{ key: "d2", value: "b" },
		]);
		expect(await store.deleteMany(["d1", "absent", "d2"])).toEqual([
			true,
			false,
			true,
		]);
	});

	it("empty batch inputs", async () => {
		expect(await store.setMany([])).toEqual([]);
		expect(await store.getMany([])).toEqual([]);
		expect(await store.hasMany([])).toEqual([]);
		expect(await store.deleteMany([])).toEqual([]);
	});
});

describe("KeyvAerospike v6 namespace clear + iterator", () => {
	it("clear only affects the current namespace", async () => {
		const a = new KeyvAerospike({ hosts: aerospikeHosts, namespace: "nsA" });
		const b = new KeyvAerospike({ hosts: aerospikeHosts, namespace: "nsB" });
		a.on("error", () => {});
		b.on("error", () => {});
		await a.set("nsA::x", "ax");
		await b.set("nsB::y", "by");
		await a.clear();
		expect(await a.get("nsA::x")).toBeUndefined();
		expect(await b.get("nsB::y")).toBe("by");
		await b.clear();
		await a.disconnect();
		await b.disconnect();
	});

	it("iterator yields only the matching namespace", async () => {
		const a = new KeyvAerospike({ hosts: aerospikeHosts, namespace: "itA" });
		a.on("error", () => {});
		await a.clear();
		await a.set("itA::1", "one");
		await a.set("itA::2", "two");
		const seen: Record<string, unknown> = {};
		for await (const [key, value] of a.iterator("itA")) {
			seen[key as string] = value;
		}
		expect(seen).toEqual({ "itA::1": "one", "itA::2": "two" });
		await a.clear();
		await a.disconnect();
	});
});

describe("KeyvAerospike v6 read-compat with v1 records", () => {
	it("reads a v1-shaped record (no expires bin)", async () => {
		const store = makeStore();
		const client = await store.getClient();
		// Simulate a v1 record: value/key/namespace bins, no expires bin.
		const Aerospike = (await import("aerospike")).default;
		const asKey = new Aerospike.Key("keyv", "keyv", "legacy::k");
		await client.put(asKey, {
			value: { value: "legacy-value" },
			key: "legacy::k",
			namespace: "legacy",
		});
		expect(await store.get("legacy::k")).toBe("legacy-value");
		await store.delete("legacy::k");
		await store.disconnect();
	});

	it("reads a v1-shaped namespaced record (namespace:key format)", async () => {
		const store = new KeyvAerospike({ hosts: aerospikeHosts });
		store.namespace = "legacy";
		store.on("error", () => {});
		const client = await store.getClient();
		// keyv v5 stored namespaced records at `${namespace}:${key}` = "legacy:mykey".
		const Aerospike = (await import("aerospike")).default;
		const asKey = new Aerospike.Key("keyv", "keyv", "legacy:mykey");
		await client.put(asKey, {
			value: { value: "namespaced-value" },
			key: "mykey",
			namespace: "legacy",
		});
		expect(await store.get("mykey")).toBe("namespaced-value");
		await store.delete("mykey");
		await store.disconnect();
	});
});

describe("createKeyv (v6)", () => {
	it("round-trips and supports native keyv.iterator()", async () => {
		const keyv = createKeyv({ hosts: aerospikeHosts }, { namespace: "ck6" });
		keyv.on("error", () => {});
		expect(keyv).toBeInstanceOf(Keyv);
		await keyv.clear();
		await keyv.set("a", "1");
		await keyv.set("b", "2");
		expect(await keyv.get("a")).toBe("1");
		const seen: Record<string, unknown> = {};
		for await (const [key, value] of keyv.iterator()) {
			seen[key] = value;
		}
		expect(seen).toEqual({ a: "1", b: "2" });
		await keyv.clear();
		await keyv.disconnect();
	});
});
