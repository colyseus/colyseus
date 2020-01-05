import assert from "assert";

import { ArraySchema, defineTypes, filter, MapSchema, Schema, type } from "@colyseus/schema";
import { SchemaSerializer } from "../src";

describe("SchemaSerializer", () => {
  const serializer = new SchemaSerializer();

  describe("hasFilter", () => {
    it("should return false", () => {
      class State extends Schema {
        @type("string") str: string;
      }

      assert.ok(!serializer.hasFilter(State._schema, State._filters));
    });

    it("should return true", () => {
      class State extends Schema {
        @filter(function (client, value, root) {
          return true;
        })
        @type("string") str: string;
      }

      assert.ok(serializer.hasFilter(State._schema, State._filters));
    });

    it("should be able to navigate on recursive structures", () => {
      class Container extends Schema {
        @type("string") name: string;

        @type([Container]) arrayOfContainers: ArraySchema<Container>;
        @type({ map: Container }) mapOfContainers: MapSchema<Container>;
      }
      class State extends Schema {
        @type(Container) root: Container;
      }

      const fun = () => serializer.hasFilter(State._schema, State._filters);

      assert.doesNotThrow(fun);
      assert.equal(false, fun());
    });

    it("should be able to navigate on more complex recursive structures", () => {
      class ContainerA extends Schema {
        @type("string") contAName: string;
      }
      class ContainerB extends Schema {
        @type("string") contBName: string;
      }
      class State extends Schema {
      }

      const allContainers = [State, ContainerA, ContainerB];
      allContainers.forEach((cont) => {
        defineTypes(cont, {
          containersA: [ContainerA],
          containersB: [ContainerB],
        });
      });

      const fun = () => serializer.hasFilter(State._schema, State._filters);

      assert.doesNotThrow(fun);
      assert.equal(false, fun());
    });

    it("should find filter on more complex recursive structures", () => {
      class ContainerA extends Schema {
        @type("string") contAName: string;
      }
      class ContainerB extends Schema {
        @filter(function (client, value, root) { return true; })
        @type("string")
        contBName: string;
      }
      class State extends Schema {
      }

      const allContainers = [State, ContainerA, ContainerB];
      allContainers.forEach((cont) => {
        defineTypes(cont, {
          containersA: [ContainerA],
          containersB: [ContainerB],
        });
      });

      assert.ok(serializer.hasFilter(State._schema, State._filters));
    });

    it("should be able to navigate on maps and arrays of primitive types", () => {
      class State extends Schema {
        @type(["string"]) stringArr: MapSchema<string>;
        @type(["number"]) numberArr: MapSchema<number>;
        @type(["boolean"]) booleanArr: MapSchema<boolean>;
        @type({ map: "string" }) stringMap: MapSchema<string>;
        @type({ map: "number" }) numberMap: MapSchema<number>;
        @type({ map: "boolean" }) booleanMap: MapSchema<boolean>;
      }

      const fun = () => serializer.hasFilter(State._schema, State._filters);

      assert.doesNotThrow(fun);
      assert.equal(false, fun());
    });
  });
});
