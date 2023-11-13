import assert from "assert";
import { JsonWebToken, JwtPayload, auth } from "../src/index";
import express from "express";

// JWT Secret for testing
// JsonWebToken.options.verify.algorithms = ['HS512'];
JsonWebToken.options.secret = "@%^&";

describe("Auth", () => {

  it("should return express routes", async () => {
    const app = express();
    app.use(auth.prefix, auth.routes({ }));

  });

  it("should sign and verify token", async () => {
    const data = { id: 1, name: "Jake Badlands", email: "jake@badlands.io" }
    const token = await JsonWebToken.sign(data);

    const verify = await JsonWebToken.verify(token) as JwtPayload;
    delete verify.iat;

    assert.deepEqual(data, verify);
  });

});