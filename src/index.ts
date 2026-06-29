import Aerospike, {
	AerospikeError,
	type AerospikeRecord,
	type Client,
	type ConfigOptions,
	type Key,
} from "aerospike";
import { Hookified } from "hookified";
import type { KeyvStoreAdapter, StoredData } from "keyv";
import { parseConnectionString } from "./utils.js";

export type KeyvAerospikeOptions = {
	namespace?: string;
	keyPrefixSeparator?: string;
	aerospikeNamespace?: string;
	set?: string;
	clearBatchSize?: number;
	noNamespaceAffectsAll?: boolean;
	throwOnErrors?: boolean;
	throwOnConnectError?: boolean;
	connectionTimeout?: number;
};

// Internal opts: KeyvAerospikeOptions + required fields consumed by Keyv internals
type KeyvAerospikeInternalOpts = KeyvAerospikeOptions & {
	dialect: string;
	url: string;
};

function isClient(value: unknown): value is Client {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Client).connect === "function" &&
		typeof (value as Client).isConnected === "function"
	);
}

export class KeyvAerospike extends Hookified implements KeyvStoreAdapter {
	public opts: KeyvAerospikeInternalOpts;
	public namespace?: string;

	private _client: Client;
	private _asNamespace: string;
	private _set: string;
	private _clearBatchSize: number;
	private _noNamespaceAffectsAll: boolean;
	private _throwOnErrors: boolean;
	private _throwOnConnectError: boolean;

	constructor(
		connect?: string | ConfigOptions | Client,
		options: KeyvAerospikeOptions = {},
	) {
		super();

		// Support combined first-arg: new KeyvAerospike({ hosts, namespace, ... })
		let resolvedOptions = options;
		if (connect && typeof connect === "object" && !isClient(connect)) {
			const c = connect as ConfigOptions & KeyvAerospikeOptions;
			const keyvKeys = [
				"namespace",
				"keyPrefixSeparator",
				"aerospikeNamespace",
				"set",
				"clearBatchSize",
				"noNamespaceAffectsAll",
				"throwOnErrors",
				"throwOnConnectError",
				"connectionTimeout",
			] as const;
			const extracted: KeyvAerospikeOptions = {};
			for (const key of keyvKeys) {
				if (c[key] !== undefined)
					(extracted as Record<string, unknown>)[key] = c[key];
			}
			resolvedOptions = { ...extracted, ...options };
		}

		this.opts = {
			...resolvedOptions,
			dialect: "aerospike",
			url: "",
		};
		this.namespace = resolvedOptions.namespace;
		this._asNamespace = resolvedOptions.aerospikeNamespace ?? "keyv";
		this._set = resolvedOptions.set ?? "keyv";
		this._clearBatchSize = resolvedOptions.clearBatchSize ?? 1000;
		this._noNamespaceAffectsAll =
			resolvedOptions.noNamespaceAffectsAll ?? false;
		this._throwOnErrors = resolvedOptions.throwOnErrors ?? false;
		this._throwOnConnectError = resolvedOptions.throwOnConnectError ?? true;

		if (isClient(connect)) {
			this._client = connect;
		} else {
			let config: ConfigOptions = {};
			if (typeof connect === "string") {
				const parsed = parseConnectionString(connect);
				config = { hosts: parsed.hosts };
				if (parsed.user) config.user = parsed.user;
				if (parsed.password) config.password = parsed.password;
				if (parsed.set) this._set = parsed.set;
				if (parsed.aerospikeNamespace)
					this._asNamespace = parsed.aerospikeNamespace;
			} else if (connect) {
				const {
					namespace: _ns,
					keyPrefixSeparator: _kps,
					aerospikeNamespace: _an,
					set: _s,
					clearBatchSize: _cbs,
					noNamespaceAffectsAll: _nnaa,
					throwOnErrors: _toe,
					throwOnConnectError: _toce,
					connectionTimeout: _ct,
					...aerospikeConfig
				} = connect as ConfigOptions & KeyvAerospikeOptions;
				config = aerospikeConfig as ConfigOptions;
			}
			// Wire connectionTimeout to the Aerospike client's connTimeoutMs field
			if (typeof resolvedOptions.connectionTimeout === "number") {
				config.connTimeoutMs = resolvedOptions.connectionTimeout;
			}
			this._client = Aerospike.client(config);
		}
	}

	private createKey(key: string): Key {
		return new Aerospike.Key(this._asNamespace, this._set, key);
	}

	private isNotFound(error: unknown): boolean {
		return (
			error instanceof AerospikeError &&
			error.code === Aerospike.status.ERR_RECORD_NOT_FOUND
		);
	}

	private handleError(error: unknown): void {
		this.emit("error", error);
		if (this._throwOnErrors) {
			throw error;
		}
	}

	public async getClient(): Promise<Client> {
		if (this._client.isConnected(false)) {
			return this._client;
		}
		try {
			await this._client.connect();
		} catch (error) {
			if (this._throwOnConnectError) {
				throw error;
			}
			this.emit("error", error);
		}
		return this._client;
	}

	// Scans the set and returns all records matching the given predicate.
	private async _scanAll(
		match: (record: AerospikeRecord) => boolean,
	): Promise<AerospikeRecord[]> {
		const client = await this.getClient();
		return new Promise((resolve, reject) => {
			const collected: AerospikeRecord[] = [];
			const stream = client.scan(this._asNamespace, this._set).foreach();
			stream.on("data", (record: AerospikeRecord) => {
				if (match(record)) {
					collected.push(record);
				}
			});
			stream.on("error", reject);
			stream.on("end", () => resolve(collected));
		});
	}

	public async get<Value>(key: string): Promise<StoredData<Value> | undefined> {
		try {
			const client = await this.getClient();
			const record = await client.get(this.createKey(key));
			return (
				record.bins.value as unknown as { value: StoredData<Value> } | undefined
			)?.value;
		} catch (error) {
			if (this.isNotFound(error)) {
				return undefined;
			}
			this.handleError(error);
			return undefined;
		}
	}

	public async set(
		key: string,
		value: unknown,
		ttl?: number,
	): Promise<boolean> {
		try {
			const client = await this.getClient();
			const bins = { value: { value }, key, namespace: this.namespace ?? "" };
			const ttlSeconds =
				typeof ttl === "number" && ttl > 0
					? Math.max(1, Math.ceil(ttl / 1000))
					: Aerospike.ttl.NEVER_EXPIRE;
			await client.put(this.createKey(key), bins, { ttl: ttlSeconds });
			return true;
		} catch (error) {
			this.handleError(error);
			return false;
		}
	}

	public async delete(key: string): Promise<boolean> {
		try {
			const client = await this.getClient();
			await client.remove(this.createKey(key));
			return true;
		} catch (error) {
			if (this.isNotFound(error)) {
				return false;
			}
			this.handleError(error);
			return false;
		}
	}

	public async has(key: string): Promise<boolean> {
		try {
			const client = await this.getClient();
			return await client.exists(this.createKey(key));
		} catch (error) {
			this.handleError(error);
			return false;
		}
	}

	public async getMany<Value>(
		keys: string[],
	): Promise<Array<StoredData<Value> | undefined>> {
		if (keys.length === 0) {
			return [];
		}
		try {
			const client = await this.getClient();
			const batch = keys.map((key) => ({
				key: this.createKey(key),
				readAllBins: true,
			}));
			const results = await client.batchRead(batch);
			// Aerospike SDK returns batch results in input order — keys.map index aligns with results index
			return keys.map((_, index) => {
				const result = results[index];
				if (result?.status === Aerospike.status.OK) {
					return (
						result.record.bins.value as unknown as
							| { value: StoredData<Value> }
							| undefined
					)?.value;
				}
				return undefined;
			});
		} catch (error) {
			this.handleError(error);
			return keys.map(() => undefined);
		}
	}

	public async hasMany(keys: string[]): Promise<boolean[]> {
		if (keys.length === 0) {
			return [];
		}
		try {
			const client = await this.getClient();
			const results = await client.batchExists(
				keys.map((key) => this.createKey(key)),
			);
			// Aerospike SDK returns batch results in input order — keys.map index aligns with results index
			return keys.map(
				(_, index) => results[index]?.status === Aerospike.status.OK,
			);
		} catch (error) {
			this.handleError(error);
			return keys.map(() => false);
		}
	}

	public async setMany(
		entries: Array<{ key: string; value: unknown; ttl?: number }>,
	): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		try {
			await Promise.all(
				entries.map((entry) => this.set(entry.key, entry.value, entry.ttl)),
			);
		} catch (error) {
			this.handleError(error);
		}
	}

	public async deleteMany(keys: string[]): Promise<boolean> {
		if (keys.length === 0) {
			return true;
		}
		try {
			const client = await this.getClient();
			const results = await client.batchRemove(
				keys.map((key) => this.createKey(key)),
			);
			return results.every((result) => result.status === Aerospike.status.OK);
		} catch (error) {
			this.handleError(error);
			return false;
		}
	}

	public async clear(): Promise<void> {
		try {
			const ns = this.namespace ?? "";

			if (!this.namespace && this._noNamespaceAffectsAll) {
				const client = await this.getClient();
				await client.truncate(this._asNamespace, this._set, 0);
				return;
			}

			const records = await this._scanAll(
				(record) => (record.bins.namespace ?? "") === ns,
			);
			const keysToDelete = records.map((record) => record.key);

			const client = await this.getClient();
			for (let i = 0; i < keysToDelete.length; i += this._clearBatchSize) {
				await client.batchRemove(
					keysToDelete.slice(i, i + this._clearBatchSize),
				);
			}
		} catch (error) {
			this.handleError(error);
		}
	}

	public async *iterator<Value>(
		namespace?: string,
	): AsyncGenerator<Array<string | Awaited<Value> | undefined>, void> {
		try {
			const ns = namespace ?? this.namespace ?? "";
			const records = await this._scanAll(
				(record) => (record.bins.namespace ?? "") === ns,
			);

			for (const record of records) {
				if (typeof record.bins.key !== "string") continue;
				const value = (
					record.bins.value as { value: Awaited<Value> } | null | undefined
				)?.value;
				yield [record.bins.key, value];
			}
		} catch (error) {
			this.handleError(error);
		}
	}

	public async disconnect(): Promise<void> {
		if (this._client.isConnected(false)) {
			this._client.close(false);
		}
	}
}

export default KeyvAerospike;
export { createKeyv } from "./create.js";
