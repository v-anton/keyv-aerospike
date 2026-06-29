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
	return keyv;
}
