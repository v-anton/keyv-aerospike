import Aerospike from "aerospike";
import Keyv from "keyv";
import { afterAll, describe, expect, it } from "vitest";
import { KeyvAerospike, createKeyv } from "../src/index.js";
import { aerospikeHosts } from "./helpers.js";

const makeStore = () => {
	const store = new KeyvAerospike({ hosts: aerospikeHosts });
	store.on("error", () => {});
	return store;
};

describe("KeyvAerospike core", () => {
	const store = makeStore();
	afterAll(async () => {
		await store.disconnect?.();
	});

	it("sets and gets a value", async () => {
		await store.set("k1", "hello");
		expect(await store.get("k1")).toBe("hello");
	});

	it("returns undefined for a missing key", async () => {
		expect(await store.get("missing-key")).toBeUndefined();
	});

	it("stores objects via passthrough (no re-serialization)", async () => {
		const payload = { a: 1, b: "two" };
		await store.set("k2", payload);
		expect(await store.get("k2")).toEqual(payload);
	});

	it("reports has() correctly", async () => {
		await store.set("k3", "v");
		expect(await store.has("k3")).toBe(true);
		expect(await store.has("nope")).toBe(false);
	});

	it("deletes a key and reports false on a second delete", async () => {
		await store.set("k4", "v");
		expect(await store.delete("k4")).toBe(true);
		expect(await store.delete("k4")).toBe(false);
		expect(await store.get("k4")).toBeUndefined();
	});

	it("expires a key with a ttl", async () => {
		await store.set("k5", "v", 1000);
		await new Promise((r) => setTimeout(r, 2500));
		expect(await store.get("k5")).toBeUndefined();
	});

	it("stores a key without a ttl under the namespace default-ttl", async () => {
		// aerospike.conf declares default-ttl 30 on the keyv namespace.
		await store.set("k6", "v");
		const client = await store.getClient();
		const record = await client.get(new Aerospike.Key("keyv", "keyv", "k6"));
		expect(record.ttl).toBeGreaterThan(0);
		expect(record.ttl).toBeLessThanOrEqual(30);
	});
});

describe("KeyvAerospike clear", () => {
	it("clears only the current namespace", async () => {
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
});

describe("KeyvAerospike iterator", () => {
	it("yields only the matching namespace's entries", async () => {
		const a = new KeyvAerospike({ hosts: aerospikeHosts, namespace: "itA" });
		const b = new KeyvAerospike({ hosts: aerospikeHosts, namespace: "itB" });
		a.on("error", () => {});
		b.on("error", () => {});
		await a.clear();
		await b.clear();

		await a.set("itA::1", "one");
		await a.set("itA::2", "two");
		await b.set("itB::3", "three");

		const seen: Record<string, unknown> = {};
		for await (const [key, value] of a.iterator("itA")) {
			seen[key] = value;
		}

		expect(seen).toEqual({ "itA::1": "one", "itA::2": "two" });

		await a.clear();
		await b.clear();
		await a.disconnect();
		await b.disconnect();
	});
});

describe("KeyvAerospike batch reads", () => {
	const store = new KeyvAerospike({ hosts: aerospikeHosts });
	store.on("error", () => {});
	afterAll(async () => {
		await store.disconnect();
	});

	it("getMany returns values in order with undefined for misses", async () => {
		await store.set("g1", "a");
		await store.set("g2", "b");
		expect(await store.getMany(["g1", "absent", "g2"])).toEqual([
			"a",
			undefined,
			"b",
		]);
	});

	it("getMany returns [] for an empty input", async () => {
		expect(await store.getMany([])).toEqual([]);
	});

	it("hasMany returns existence flags in order", async () => {
		await store.set("h1", "a");
		expect(await store.hasMany(["h1", "absent"])).toEqual([true, false]);
	});
});

describe("KeyvAerospike batch writes", () => {
	const store = new KeyvAerospike({ hosts: aerospikeHosts });
	store.on("error", () => {});
	afterAll(async () => {
		await store.disconnect();
	});

	it("setMany stores all entries", async () => {
		await store.setMany([
			{ key: "s1", value: "a" },
			{ key: "s2", value: "b" },
		]);
		expect(await store.getMany(["s1", "s2"])).toEqual(["a", "b"]);
	});

	it("deleteMany removes all keys and returns true", async () => {
		await store.setMany([
			{ key: "d1", value: "a" },
			{ key: "d2", value: "b" },
		]);
		expect(await store.deleteMany(["d1", "d2"])).toBe(true);
		expect(await store.getMany(["d1", "d2"])).toEqual([undefined, undefined]);
	});

	it("deleteMany returns true for an empty input", async () => {
		expect(await store.deleteMany([])).toBe(true);
	});

	it("deleteMany returns false when any key is absent", async () => {
		await store.set("dm-present", "v");
		// One present, one absent — result must be false
		expect(await store.deleteMany(["dm-present", "dm-absent-key"])).toBe(false);
	});

	it("deleteMany returns true when all keys are present", async () => {
		await store.setMany([
			{ key: "dm-a", value: "1" },
			{ key: "dm-b", value: "2" },
		]);
		expect(await store.deleteMany(["dm-a", "dm-b"])).toBe(true);
	});
});

describe("KeyvAerospike connectionTimeout", () => {
	it("accepts connectionTimeout and still round-trips set/get", async () => {
		const store = new KeyvAerospike({
			hosts: aerospikeHosts,
			connectionTimeout: 5000,
		});
		store.on("error", () => {});
		await store.set("ct-key", "ct-value");
		expect(await store.get("ct-key")).toBe("ct-value");
		await store.disconnect();
	});
});

describe("createKeyv", () => {
	it("returns a working Keyv instance backed by Aerospike", async () => {
		const keyv = createKeyv({ hosts: aerospikeHosts }, { namespace: "ck" });
		keyv.on("error", () => {});
		expect(keyv).toBeInstanceOf(Keyv);
		await keyv.set("hello", "world");
		expect(await keyv.get("hello")).toBe("world");
		await keyv.disconnect();
	});

	it("supports keyv-level iteration (keyv.iterator())", async () => {
		const keyv = createKeyv({ hosts: aerospikeHosts }, { namespace: "ckiter" });
		keyv.on("error", () => {});
		await keyv.clear();
		await keyv.set("a", "1");
		await keyv.set("b", "2");

		const seen: Record<string, unknown> = {};
		for await (const [key, value] of keyv.iterator()) {
			seen[key] = value;
		}
		expect(seen).toEqual({ a: "1", b: "2" });

		await keyv.clear();
		await keyv.disconnect();
	});
});
