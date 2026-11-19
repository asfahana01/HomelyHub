import { Property } from "../models/propertyModel.js";
import { planTrip } from "../ai/tripPlanner.js";
import { logger } from "../utils/logger.js";

const cleanCity = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const createTripPlan = async (req, res) => {
  try {
    const { destination, budget, days, people, interests } = req.body;

    if (!destination || !budget || !days || !people) {
      return res.status(400).json({
        status: "fail",
        message: "Please provide destination, budget, days, and number of people",
      });
    }

    // Input validation
    const destStr = String(destination).trim();
    if (destStr.length < 2 || destStr.length > 100) {
      return res.status(400).json({
        status: "fail",
        message: "Destination must be between 2 and 100 characters",
      });
    }

    const budgetNum = Number(budget);
    if (!Number.isFinite(budgetNum) || budgetNum <= 0 || budgetNum > 10000000) {
      return res.status(400).json({
        status: "fail",
        message: "Budget must be a valid positive number up to ₹1,00,00,000",
      });
    }

    const daysNum = parseInt(days, 10);
    if (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 30) {
      return res.status(400).json({
        status: "fail",
        message: "Days must be an integer between 1 and 30",
      });
    }

    const peopleNum = parseInt(people, 10);
    if (!Number.isInteger(peopleNum) || peopleNum < 1 || peopleNum > 30) {
      return res.status(400).json({
        status: "fail",
        message: "Number of people must be an integer between 1 and 30",
      });
    }

    let sanitizedInterests = [];
    if (Array.isArray(interests)) {
      sanitizedInterests = interests
        .slice(0, 10)
        .map((i) => String(i).trim().slice(0, 50))
        .filter(Boolean);
    }

    const plan = await planTrip({
      destination: destStr,
      budget: budgetNum,
      days: daysNum,
      people: peopleNum,
      interests: sanitizedInterests,
    });

    const perNight = Math.round(budgetNum / daysNum);
    const city = cleanCity(destStr);

    const properties = await Property.find({
      $or: [
        { "address.city": city },
        { "address.state": city },
        { "address.area": city },
      ],
      price: { $lte: perNight },
      maximumGuest: { $gte: peopleNum },
    }).limit(6);

    res.status(200).json({
      status: "success",
      data: { plan, properties, perNight },
    });
  } catch (error) {
    const outputRejected =
      error.name === "ZodError" || error instanceof SyntaxError;
    logger[outputRejected ? "warn" : "error"](
      outputRejected
        ? "security.ai.output_rejected"
        : "ai.trip_generation_failed",
      {
        requestId: req.requestId,
        errorName: error.name || "Error",
      }
    );
    res.status(500).json({
      status: "fail",
      message: "An error occurred while creating the trip plan. Please try again later.",
    });
  }
};

export { createTripPlan };
