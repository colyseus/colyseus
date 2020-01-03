import assert from "assert";
import { Schema, ArraySchema, type, filter, MapSchema } from "@colyseus/schema";
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
        @filter(function(client, value, root) {
          return true;
        })
        @type("string") str: string;
      }

      assert.ok(serializer.hasFilter(State._schema, State._filters));
    });

    it("should identify filter on recursive structures", () => {
      class Deck extends Schema {
        @filter(function(client, value, root) {
          return true;
        })
        @type([Deck]) decks = new ArraySchema<Deck>();
      }

      class Card extends Deck {
        @type([Deck]) moreDecks = new ArraySchema<Deck>();
        @type(Card) card: Card;
      }

      class Hand extends Schema {
        @type([Card]) cards = new ArraySchema<Card>();
        @type(Deck) deck = new Deck();
      }

      class Player extends Schema {
        @type(Hand) hand = new Hand();
        @type(Deck) deck = new Deck();
      }

      class State extends Schema {
        @type(Card) card: Card;
        @type(Deck) deck = new Deck();
        @type({map: Player}) players = new MapSchema<Player>();
      }

      assert.ok(serializer.hasFilter(State._schema, State._filters));
    });

  });


});
