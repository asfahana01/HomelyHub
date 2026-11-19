import { test } from "node:test";
import assert from "node:assert/strict";
import { getEnvironmentIssues, REQUIRED_ENV_VARS } from "../src/utils/env.js";

test("environment validation reports missing names without including values", () => {
  const issues = getEnvironmentIssues({});
  assert.deepEqual(issues, REQUIRED_ENV_VARS);
  assert.ok(issues.every((value) => !value.includes("=")));
});

test("environment validation rejects placeholders and undersized signing keys", () => {
  const env = Object.fromEntries(
    REQUIRED_ENV_VARS.map((key) => [key, "configured-value"])
  );
  env.JWT_SECRET = "short";
  env.COOKIE_SECRET = "your_cookie_secret_value_with_more_than_32_chars";
  env.MONGO_URI = "not-a-mongodb-uri";
  assert.deepEqual(
    getEnvironmentIssues(env).sort(),
    ["COOKIE_SECRET", "JWT_SECRET", "MONGO_URI"].sort()
  );
});
