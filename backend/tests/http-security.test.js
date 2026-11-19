import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.GROQ_API_KEY ||= "test-key-not-a-credential";
const { default: app } = await import("../src/index.js");

describe("HTTP security middleware", () => {
  test("all booking endpoints require an authenticated session", async (t) => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }));

    const { port } = server.address();
    const requests = [
      ["GET", "/api/v1/rent/user/booking"],
      ["GET", "/api/v1/rent/user/booking/64b7f123456789abcdef0123"],
      ["POST", "/api/v1/rent/user/booking/create-order"],
      ["POST", "/api/v1/rent/user/booking/verify-payment"],
    ];

    for (const [method, path] of requests) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(response.status, 401, `${method} ${path} must require auth`);
      assert.ok(response.headers.get("x-request-id"));
    }
  });

  test("liveness stays independent of database readiness", async (t) => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }));

    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/health`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  test("readiness reports an unavailable database without exposing configuration", async (t) => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }));

    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/ready`
    );
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, "not_ready");
    assert.equal(body.checks.database, "not_ready");
    assert.equal(JSON.stringify(body).includes("secret"), false);
  });
});
