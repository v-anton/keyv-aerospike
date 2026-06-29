# keyv-aerospike

> Aerospike storage adapter for [Keyv](https://github.com/jaredwray/keyv) — v1 / keyv-v5 line.

[![npm version](https://img.shields.io/npm/v/keyv-aerospike)](https://www.npmjs.com/package/keyv-aerospike)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Install

```bash
npm install keyv-aerospike aerospike keyv
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

- TTLs are passed as seconds to Aerospike (`Math.ceil(ttl / 1000)`), minimum 1 s.
- TTL `0` or no TTL stores the record with `NEVER_EXPIRE`.
- Aerospike evicts expired records server-side; no application-side expiry is needed.

## Iteration

`store.iterator(namespace?)` works directly and yields `[key, value]` pairs filtered to the given namespace.

To iterate the **Keyv instance** (`keyv.iterator()` or `for await (const [key, value] of keyv)`), create it with `createKeyv()`:

```js
import { createKeyv } from 'keyv-aerospike';

const keyv = createKeyv('aerospike://localhost:3000', { namespace: 'app' });
await keyv.set('a', 1);
for await (const [key, value] of keyv.iterator()) {
  console.log(key, value);
}
```

`createKeyv()` wires iteration explicitly. Note: keyv core only auto-wires `keyv.iterator()` for adapters in its built-in `iterableAdapters` allowlist (which omits `aerospike`), so a manually-constructed `new Keyv(new KeyvAerospike(...))` does **not** support `keyv.iterator()` — use `createKeyv()` or call `store.iterator()` directly.

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
