import type { Client, ConfigOptions } from "aerospike";
import Keyv from "keyv";
import { KeyvAerospike, type KeyvAerospikeOptions } from "./index.js";

export function createKeyv(
	connect?: string | ConfigOptions | Client,
	options?: KeyvAerospikeOptions,
): Keyv {
	const store = new KeyvAerospike(connect, options);
	const keyv = new Keyv(store, { namespace: options?.namespace });
	if (options?.throwOnErrors) {
		keyv.throwOnErrors = true;
	}
	// keyv core only auto-wires `keyv.iterator()` for adapters in its built-in
	// dialect allowlist, which omits aerospike. Wire our store's iterator
	// explicitly so iterating the Keyv instance returned by createKeyv works.
	if (typeof store.iterator === "function") {
		keyv.iterator = keyv.generateIterator(store.iterator.bind(store));
	}
	return keyv;
}
