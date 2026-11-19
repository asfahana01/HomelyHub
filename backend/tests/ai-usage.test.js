import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AiUsage } from "../src/models/aiUsageModel.js";
import { reserveAiUsage } from "../src/services/aiUsageService.js";

describe("per-user AI usage limits", () => {
  test("atomically reserves estimated tokens and request count for the UTC day", async (t) => {
    const previousTokenLimit = process.env.AI_DAILY_TOKEN_LIMIT;
    const previousRequestLimit = process.env.AI_DAILY_REQUEST_LIMIT;
    process.env.AI_DAILY_TOKEN_LIMIT = "1000";
    process.env.AI_DAILY_REQUEST_LIMIT = "5";
    t.after(() => {
      if (previousTokenLimit === undefined) delete process.env.AI_DAILY_TOKEN_LIMIT;
      else process.env.AI_DAILY_TOKEN_LIMIT = previousTokenLimit;
      if (previousRequestLimit === undefined) delete process.env.AI_DAILY_REQUEST_LIMIT;
      else process.env.AI_DAILY_REQUEST_LIMIT = previousRequestLimit;
    });

    let updateFilter;
    let increments;
    t.mock.method(AiUsage, "updateOne", async () => ({ upsertedCount: 1 }));
    t.mock.method(AiUsage, "findOneAndUpdate", async (filter, update) => {
      updateFilter = filter;
      increments = update.$inc;
      return { _id: filter._id };
    });

    const reserved = await reserveAiUsage("user-id", { destination: "Goa" }, 500);
    assert.ok(reserved > 500);
    assert.match(updateFilter._id, /^user-id:\d{4}-\d{2}-\d{2}$/);
    assert.equal(increments.requests, 1);
    assert.equal(increments.tokensReserved, reserved);
    assert.equal(updateFilter.requests.$lt, 5);
  });

  test("rejects a reservation larger than the user's daily token budget", async (t) => {
    const previousTokenLimit = process.env.AI_DAILY_TOKEN_LIMIT;
    process.env.AI_DAILY_TOKEN_LIMIT = "100";
    t.after(() => {
      if (previousTokenLimit === undefined) delete process.env.AI_DAILY_TOKEN_LIMIT;
      else process.env.AI_DAILY_TOKEN_LIMIT = previousTokenLimit;
    });

    await assert.rejects(
      reserveAiUsage("user-id", { destination: "Goa" }, 101),
      (error) => error.statusCode === 429
    );
  });
});
