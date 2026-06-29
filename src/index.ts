import Aerospike, {
	AerospikeError,
	type AerospikeBins,
	type AerospikeRecord,
	type Client,
	type ConfigOptions,
	type Key,
} from "aerospike";
import { Hookified } from "hookified";
import {
	type KeyvStorageAdapter,
	type KeyvStorageCapability,
	type KeyvStorageEntry,
	type KeyvStorageGetResult,
	keyvStorageCapability,
} from "keyv";
import { parseConnectionString } from "./utils.js";

export type KeyvAerospikeOptions = {
	namespace?: string;
	aerospikeNamespace?: string;
	set?: string;
	clearBatchSize?: number;
	noNamespaceAffectsAll?: boolean;
	throwOnErrors?: boolean;
	throwOnConnectError?: boolean;
	connectionTimeout?: number;
};

function isClient(value: unknown): value is Client {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Client).connect === "function" &&
		typeof (value as Client).isConnected === "function"
	);
}

export class KeyvAerospike extends Hookified implements KeyvStorageAdapter {
	public opts: KeyvAerospikeOptions;
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

		let resolvedOptions = options;
		if (connect && typeof connect === "object" && !isClient(connect)) {
			const c = connect as ConfigOptions & KeyvAerospikeOptions;
			const keyvKeys = [
				"namespace",
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

		this.opts = resolvedOptions;
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
			if (typeof resolvedOptions.connectionTimeout === "number") {
				config.connTimeoutMs = resolvedOptions.connectionTimeout;
			}
			this._client = Aerospike.client(config);
		}
	}

	// v6: declare the absolute-expires storage contract. Obliges this adapter
	// to enforce expiry on read.
	public get capabilities(): KeyvStorageCapability {
		return keyvStorageCapability(this);
	}

	// The namespace separator is fixed at ":" to match keyv v5's
	// `${namespace}:${key}` storage-key format. Changing it would silently break
	// read-compatibility with records written by keyv-aerospike v1.
	private createKey(key: string): Key {
		const storageKey = this.namespace ? `${this.namespace}:${key}` : key;
		return new Aerospike.Key(this._asNamespace, this._set, storageKey);
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

	private isExpired(record: AerospikeRecord): boolean {
		const expires = record.bins.expires;
		return typeof expires === "number" && expires <= Date.now();
	}

	private readValue<Value>(
		record: AerospikeRecord,
	): KeyvStorageGetResult<Value> {
		return (
			record.bins.value as unknown as
				| { value: KeyvStorageGetResult<Value> }
				| undefined
		)?.value;
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

	public async get<Value>(key: string): Promise<KeyvStorageGetResult<Value>> {
		try {
			const client = await this.getClient();
			const record = await client.get(this.createKey(key));
			if (this.isExpired(record)) {
				await this.delete(key);
				return undefined;
			}
			return this.readValue<Value>(record);
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
		expires?: number,
	): Promise<boolean> {
		try {
			// Already-expired writes must not persist.
			if (typeof expires === "number" && expires <= Date.now()) {
				await this.delete(key);
				return true;
			}
			const client = await this.getClient();
			const bins: Record<string, unknown> = {
				value: { value },
				key,
				namespace: this.namespace ?? "",
			};
			let ttlSeconds = Aerospike.ttl.NEVER_EXPIRE;
			if (typeof expires === "number") {
				bins.expires = expires;
				ttlSeconds = Math.max(1, Math.ceil((expires - Date.now()) / 1000));
			}
			await client.put(this.createKey(key), bins as AerospikeBins, {
				ttl: ttlSeconds,
			});
			return true;
		} catch (error) {
			this.handleError(error);
			return false;
		}
	}

	public async setMany<Value>(
		entries: KeyvStorageEntry<Value>[],
	): Promise<boolean[]> {
		if (entries.length === 0) {
			return [];
		}
		return Promise.all(
			entries.map((entry) => this.set(entry.key, entry.value, entry.expires)),
		);
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

	public async deleteMany(keys: string[]): Promise<boolean[]> {
		if (keys.length === 0) {
			return [];
		}
		try {
			const client = await this.getClient();
			const results = await client.batchRemove(
				keys.map((key) => this.createKey(key)),
			);
			// Aerospike returns batch results in input order.
			return keys.map(
				(_, index) => results[index]?.status === Aerospike.status.OK,
			);
		} catch (error) {
			this.handleError(error);
			return keys.map(() => false);
		}
	}

	public async has(key: string): Promise<boolean> {
		return (await this.get(key)) !== undefined;
	}

	public async hasMany(keys: string[]): Promise<boolean[]> {
		const values = await this.getMany(keys);
		return values.map((value) => value !== undefined);
	}

	public async getMany<Value>(
		keys: string[],
	): Promise<Array<KeyvStorageGetResult<Value | undefined>>> {
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
			const now = Date.now();
			// Aerospike returns batch results in input order.
			return keys.map((_, index) => {
				const result = results[index];
				if (result?.status !== Aerospike.status.OK) {
					return undefined;
				}
				const expires = result.record.bins.expires;
				// Expired records are reported absent but not deleted here; Aerospike native TTL reclaims them (avoids an N-delete storm on bulk reads).
				if (typeof expires === "number" && expires <= now) {
					return undefined;
				}
				return this.readValue<Value>(result.record);
			});
		} catch (error) {
			this.handleError(error);
			return keys.map(() => undefined);
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
			const now = Date.now();
			for (const record of records) {
				if (typeof record.bins.key !== "string") continue;
				const expires = record.bins.expires;
				// Skip expired records; native TTL reclaims them (no lazy delete on scan).
				if (typeof expires === "number" && expires <= now) continue;
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
