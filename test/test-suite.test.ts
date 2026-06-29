import { keyvTestSuite, storageTestSuite } from "@keyv/test-suite";
import Keyv from "keyv";
import * as vitest from "vitest";
import { KeyvAerospike } from "../src/index.js";
import { aerospikeHosts } from "./helpers.js";

const store = () => {
	const adapter = new KeyvAerospike({ hosts: aerospikeHosts });
	adapter.on("error", () => {});
	return adapter;
};

// Adapter-level v6 contract (basic, batch, iterator, ttl, namespace, disconnect).
// Aerospike TTL granularity is whole seconds, so use the seconds profile.
storageTestSuite(vitest.it, store, { ttlGranularity: "seconds" });

// keyv-level behavior (api, values, namespace) through a Keyv instance.
keyvTestSuite(vitest.it, Keyv, store);
