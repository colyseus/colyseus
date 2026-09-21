# @colyseus/drizzle-driver

PostgreSQL driver for Colyseus using Drizzle ORM.

## Installation

```bash
npm install @colyseus/drizzle-driver
```

## Usage

### Basic Usage (with DATABASE_URL)

If no options are provided, the driver will use `process.env.DATABASE_URL`:

```typescript
import { Server } from '@colyseus/core';
import { PostgresDriver } from '@colyseus/drizzle-driver';

const gameServer = new Server({
  driver: new PostgresDriver()
});
```

### Using with your own Drizzle instance

If you already have a Drizzle database instance, you can provide it directly:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Server } from '@colyseus/core';
import { PostgresDriver } from '@colyseus/drizzle-driver';

const sql = postgres('postgresql://user:password@localhost:5432/database');
const db = drizzle(sql);

const gameServer = new Server({
  driver: new PostgresDriver({ db })
});
```

### Using with a custom schema

You can provide your own custom schema definition if you need to customize the table name or structure:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, text, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { Server } from '@colyseus/core';
import { PostgresDriver } from '@colyseus/drizzle-driver';

// Define a custom schema (e.g., with a different table name)
const myCustomRoomCaches = pgTable('my_custom_room_table', {
  roomId: text('roomId').primaryKey(),
  clients: integer('clients').notNull(),
  locked: boolean('locked'),
  private: boolean('private'),
  maxClients: integer('maxClients').notNull(),
  metadata: jsonb('metadata'),
  name: text('name').notNull(),
  publicAddress: text('publicAddress'),
  processId: text('processId').notNull(),
  createdAt: timestamp('createdAt'),
  unlisted: boolean('unlisted'),
});

const gameServer = new Server({
  driver: new PostgresDriver({ schema: myCustomRoomCaches })
});
```

### Using both custom database and schema

You can combine both options:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Server } from '@colyseus/core';
import { PostgresDriver, roomcaches } from '@colyseus/drizzle-driver';

const sql = postgres('postgresql://user:password@localhost:5432/database');
const db = drizzle(sql);

const gameServer = new Server({
  driver: new PostgresDriver({
    db,
    schema: roomcaches // or your custom schema
  })
});
```

### Options

The driver constructor accepts an optional options object:

- `db`: (optional) An existing Drizzle database instance. If provided, the driver will use this instance instead of creating a new one from `DATABASE_URL`.
- `schema`: (optional) A custom schema table definition. If not provided, uses the default `roomcaches` schema.

## Features

- Built on [Drizzle ORM](https://orm.drizzle.team/) and [postgres.js](https://github.com/porsager/postgres)
- Type-safe database operations
- Efficient query building
- Full support for all Colyseus MatchMaker operations

## Schema

The driver automatically creates a `roomcaches` table with the following structure:

- `roomId` (TEXT, PRIMARY KEY)
- `clients` (INTEGER)
- `locked` (BOOLEAN, nullable)
- `private` (BOOLEAN, nullable)
- `maxClients` (INTEGER)
- `metadata` (JSONB, nullable)
- `name` (TEXT)
- `publicAddress` (TEXT, nullable)
- `processId` (TEXT)
- `createdAt` (TIMESTAMP, nullable)
- `unlisted` (BOOLEAN, nullable)

## Environment Variables

If no connection string is provided, the driver will use the `DATABASE_URL` environment variable, or fall back to:
```
postgresql://postgres:postgres@localhost:5432/postgres
```

## License

MIT
