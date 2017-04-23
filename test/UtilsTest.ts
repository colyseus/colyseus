"use strict";

import * as assert from "assert";
import { toJSON } from "../src/Utils";

describe('Utils', function() {

  describe('toJSON', () => {

    let obj = {
      num: 1,
      str: "hello world",
      float: 1.1,
      func: function() {},
      nested: {
        num: 1,
        str: "hello world",
        float: 1.1,
        func: function() {}
      }
    };

    it("shouldn't copy functions into the result", () => {
      assert.deepEqual(toJSON(obj), {
        num: 1,
        str: "hello world",
        float: 1.1,
        nested: {
          num: 1,
          str: "hello world",
          float: 1.1
        }
      });
    });

  });

});
