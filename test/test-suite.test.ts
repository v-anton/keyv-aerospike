import keyvTestSuite from "@keyv/test-suite";
import Keyv from "keyv";
import * as vitest from "vitest";
import { KeyvAerospike } from "../src/index.js";
import { aerospikeHosts } from "./helpers.js";

const store = () => {
	const adapter = new KeyvAerospike({ hosts: aerospikeHosts });
	adapter.on("error", () => {});
	return adapter;
};

keyvTestSuite(vitest, Keyv, store);
