import { describe, expect, it } from "vitest";
import { parseConnectionString } from "../src/utils.js";

describe("parseConnectionString", () => {
	it("parses a basic host:port", () => {
		expect(parseConnectionString("aerospike://localhost:3000")).toEqual({
			hosts: [{ addr: "localhost", port: 3000 }],
		});
	});

	it("defaults the port to 3000 when omitted", () => {
		expect(parseConnectionString("aerospike://localhost")).toEqual({
			hosts: [{ addr: "localhost", port: 3000 }],
		});
	});

	it("parses user and password", () => {
		expect(
			parseConnectionString("aerospike://user:pass@localhost:3000"),
		).toEqual({
			hosts: [{ addr: "localhost", port: 3000 }],
			user: "user",
			password: "pass",
		});
	});

	it("parses multiple comma-separated hosts", () => {
		expect(parseConnectionString("aerospike://h1:3000,h2:3001")).toEqual({
			hosts: [
				{ addr: "h1", port: 3000 },
				{ addr: "h2", port: 3001 },
			],
		});
	});

	it("parses set and namespace query params", () => {
		expect(
			parseConnectionString(
				"aerospike://localhost:3000?set=cache&namespace=app",
			),
		).toEqual({
			hosts: [{ addr: "localhost", port: 3000 }],
			set: "cache",
			aerospikeNamespace: "app",
		});
	});
});
