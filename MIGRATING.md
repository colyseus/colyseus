Migrating between versions of Colyseus
===

Migrating from 0.4 to 0.5
---

- Use `ClusterServer` instead of `Server`.
- `constructor` / `onInit` - no more `options` in the constructor.
- `requestJoin` - return type is now a number (`0..1`)
- **recommended:** use `patchRate` property instead of `setPatchRate()` method.

Migrating from 0.3 to 0.4
---

**constructor / patch-rate**

OLD constructor / patch-rate

```
class MyRoom extends Room {
  constructor ( options ) {
    super( options, PATH_RATE )
  }
}
```

NEW constructor / patch-rate

```
class MyRoom extends Room {
  constructor ( options ) {
    super( options )
    this.setPatchRate( PATCH_RATE )
  }
}
```
