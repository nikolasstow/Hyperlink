---
"hyperlink-ts": minor
---

Move to Effect 4.0 (stable). The `effect` peer is now `^4.0.0`, and imports follow Effect's stable module paths (`effect/http`, `effect/http-api`, `effect/rpc`, … instead of `effect/unstable/*`).

- The optional Redis peer is now `redis` (node-redis, `>=5 <7`) instead of `ioredis`: Effect's `NodeRedis` moved to node-redis, so `NodeRedis.layer` takes node-redis options (`socket: { host, port }`, `database`, `password`).
- Store journal payloads are encoded with Effect's `SchemaBinary` (Effect 4.0 removed its MessagePack codec). The journal is in memory, so nothing stored depends on the old format.
- `Node.httpServer` and the Unix-socket server build their listener into a scope they own, so `closeListen` keeps tearing the server down under Effect 4.0's rule that only owned scopes may be closed.
- `ShardMap`'s SQLite layer keeps treating a failure to open the database as a defect.
