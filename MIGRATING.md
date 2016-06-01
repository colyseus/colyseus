Migrating between versions of Colyseus server
===

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
