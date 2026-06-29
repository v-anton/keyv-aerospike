# keyv-aerospike

> Aerospike storage adapter for [Keyv](https://github.com/jaredwray/keyv) — v2 / keyv v6.

[![npm version](https://img.shields.io/npm/v/keyv-aerospike)](https://www.npmjs.com/package/keyv-aerospike)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**This is v2, targeting keyv `^6`.** If you are on keyv v5, use `keyv-aerospike@^1`.

## Install

```bash
npm install keyv@^6 keyv-aerospike@next aerospike
```

`aerospike` and `keyv` are peer dependencies. The `aerospike` native addon requires Node 18+ and the system `libyaml` library (`brew install libyaml` on macOS, `apt install libyaml-dev` on Debian/Ubuntu).

## Usage

### Basic — pass a `KeyvAerospike` store to `Keyv`

```ts
import Keyv from 'keyv';
import { KeyvAerospike } from 'keyv-aerospike';

const keyv = new Keyv(new KeyvAerospike('aerospike://127.0.0.1:3000'));

await keyv.set('hello', 'world');
console.log(await keyv.get('hello')); // 'world'
await keyv.delete('hello');
```

### Connection string form

The URL format is `aerospike://[user:pass@]host:port[,host:port]?namespace=<ns>&set=<set>`.

```ts
// Default aerospike namespace + set ("keyv"/"keyv"):
new KeyvAerospike('aerospike://127.0.0.1:3000');

// Custom aerospike namespace and set (query-param form):
new KeyvAerospike('aerospike://127.0.0.1:3000?namespace=mynamespace&set=myset');

// Multiple seed hosts with credentials:
new KeyvAerospike('aerospike://user:pass@10.0.0.1:3000,10.0.0.2:3000?namespace=mynamespace');
```

### Config-object form

```ts
import { KeyvAerospike } from 'keyv-aerospike';

const store = new KeyvAerospike({
  hosts: [{ addr: '127.0.0.1', port: 3000 }],
  aerospikeNamespace: 'keyv',
  set: 'keyv',
  namespace: 'myapp',       // keyv prefix namespace
  clearBatchSize: 1000,
});
```

### `createKeyv` helper

`createKeyv` builds the `Keyv` instance in one call:

```ts
import { createKeyv } from 'keyv-aerospike';

const keyv = createKeyv(
  { hosts: [{ addr: '127.0.0.1', port: 3000 }] },
  { namespace: 'myapp', throwOnErrors: true }
);

await keyv.set('key', 'value', 60_000); // expires in 60s
```

### Error handling

By default the adapter emits `"error"` events (Keyv listens to them). To throw instead:

```ts
const store = new KeyvAerospike({ hosts: [...], throwOnErrors: true });
store.on('error', (err) => console.error(err));
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `namespace` | `string` | `undefined` | Keyv key-prefix namespace. Keys from different namespaces do not collide. |
| `aerospikeNamespace` | `string` | `"keyv"` | Aerospike database namespace (must be declared in `aerospike.conf`). |
| `set` | `string` | `"keyv"` | Aerospike set name within the namespace. |
| `clearBatchSize` | `number` | `1000` | Records deleted per batch during `clear()`. |
| `noNamespaceAffectsAll` | `boolean` | `false` | When `true`, calling `clear()` on a store with no namespace issues a fast `truncate` — removes all records in the set. Use with caution. |
| `throwOnErrors` | `boolean` | `false` | Throw on Aerospike errors instead of emitting `"error"` and returning `undefined`/`false`. |
| `throwOnConnectError` | `boolean` | `true` | Throw when the initial connection to Aerospike fails. |
| `connectionTimeout` | `number` | — | Connection timeout in milliseconds, mapped to the Aerospike client's `connTimeoutMs`. |

## TTL behavior

Keyv v6 passes an absolute `expires` timestamp (milliseconds since epoch) to the adapter's `set` method. The adapter:

- Stores the `expires` value in a dedicated Aerospike bin alongside the record.
- Computes a relative TTL (`Math.ceil((expires - Date.now()) / 1000)`, minimum 1 s) and sets it as the Aerospike native record TTL so the server evicts the record automatically.
- Enforces expiry on every read: if `expires <= Date.now()` the record is treated as missing. Single-key `get` also deletes it lazily; bulk and scan reads (`getMany`/`hasMany`/`iterator`) treat it as absent and rely on Aerospike's native TTL for reclamation.

From a user's perspective nothing changes — you still call `keyv.set(key, value, ttlMs)` as before; Keyv v6 converts the TTL to an absolute timestamp internally.

Records stored without a TTL use `NEVER_EXPIRE`.

## Iteration

`keyv.iterator()` and `for await (const [key, value] of keyv)` work directly in keyv v6 — no special wiring is needed:

```ts
import { createKeyv } from 'keyv-aerospike';

const keyv = createKeyv('aerospike://localhost:3000', { namespace: 'app' });
await keyv.set('a', 1);
await keyv.set('b', 2);

for await (const [key, value] of keyv) {
  console.log(key, value);
}
```

`store.iterator(namespace?)` is also available directly on the `KeyvAerospike` instance and yields `[key, value]` pairs filtered to the given namespace, with expired records skipped.

## Upgrading from v1 / compatibility

| keyv version | keyv-aerospike version |
|---|---|
| keyv `^6` | `keyv-aerospike@^2` (this package) |
| keyv `^5` | `keyv-aerospike@^1` |

**Read compatibility:** v2 reads records written by v1 transparently. Both versions store keys in the same `namespace:key` format in Aerospike, so existing data is accessible without migration.

**Write format:** v2 adds an `expires` bin to each record (absent in v1 records). The adapter handles v1 records gracefully — a missing `expires` bin means the record does not expire on read.

## Running tests

### On the host (requires a running Aerospike server)

```bash
# Start Aerospike via Docker Compose
npm run test:services:start

# Full pipeline
npm run build && npm run typecheck && npm run lint && npm test
```

### Entirely in Docker (no local Node or libyaml needed)

```bash
docker compose run --rm test
```

This boots the `aerospike` service (with this repo's `aerospike.conf`, which declares the `keyv` namespace), waits until it is healthy, then runs `npm ci && npm run build && npm run lint && npm run typecheck && npm test` inside a Node 24 container.

## License

MIT — see [LICENSE](./LICENSE).
