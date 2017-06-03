Migrating between versions of Colyseus server
===

Migrating from 0.4 to 0.5
---

- `constructor` / `onInit` - no more `options` in the constructor.
- `requestJoin` - return type is now a number (`0..1`)

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
