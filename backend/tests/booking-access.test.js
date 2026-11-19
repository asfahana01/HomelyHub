import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Booking } from "../src/models/bookingModel.js";
import { getBookingDetails, getUserBookings } from "../src/controllers/bookingController.js";
import { requestSchemas } from "../src/utils/validation.js";

const response = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

describe("booking access and input boundaries", () => {
  test("booking detail lookups are scoped to the authenticated user", async (t) => {
    const userId = "64b7f123456789abcdef0789";
    const bookingId = "64b7f123456789abcdef0123";
    let filter;
    t.mock.method(Booking, "findOne", async (query) => {
      filter = query;
      return null;
    });

    const res = response();
    await getBookingDetails(
      { params: { bookingId }, user: { _id: userId }, requestId: "test" },
      res
    );

    assert.deepEqual(filter, { _id: bookingId, user: userId });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.status, "fail");
  });

  test("booking list queries only return the caller's paid bookings", async (t) => {
    let filter;
    const query = {
      sort: async () => [],
    };
    t.mock.method(Booking, "find", (value) => {
      filter = value;
      return query;
    });

    const res = response();
    await getUserBookings(
      { user: { _id: "64b7f123456789abcdef0789" } },
      res
    );

    assert.deepEqual(filter, {
      user: "64b7f123456789abcdef0789",
      paid: true,
    });
    assert.equal(res.statusCode, 200);
  });

  test("rejects NoSQL operator IDs and unknown payment fields", () => {
    assert.equal(
      requestSchemas.propertyIdParam.safeParse({
        id: { $ne: null },
      }).success,
      false
    );
    assert.equal(
      requestSchemas.createOrder.safeParse({
        propertyId: "64b7f123456789abcdef0456",
        fromDate: "2027-01-10",
        toDate: "2027-01-12",
        guests: 2,
        amount: 1,
      }).success,
      false
    );
  });
});
