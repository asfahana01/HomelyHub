import { AiUsage } from "../models/aiUsageModel.js";
import { AppError } from "../utils/AppError.js";

const dailyTokenLimit = () => Number(process.env.AI_DAILY_TOKEN_LIMIT || 20000);
const dailyRequestLimit = () => Number(process.env.AI_DAILY_REQUEST_LIMIT || 30);

export const reserveAiUsage = async (userId, input, maxOutputTokens) => {
  const tokenLimit = dailyTokenLimit();
  const requestLimit = dailyRequestLimit();
  const estimatedTokens = Math.ceil(JSON.stringify(input).length / 3) + maxOutputTokens;
  if (
    !Number.isInteger(tokenLimit) ||
    tokenLimit < 1 ||
    !Number.isInteger(requestLimit) ||
    requestLimit < 1 ||
    estimatedTokens > tokenLimit
  ) {
    throw new AppError(429, "AI usage limit exceeded");
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const filter = {
    _id: `${userId.toString()}:${dayKey}`,
    userId,
    dayKey,
  };
  try {
    await AiUsage.updateOne(
      filter,
      { $setOnInsert: { tokensReserved: 0, requests: 0 } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  const usage = await AiUsage.findOneAndUpdate(
    {
      ...filter,
      tokensReserved: { $lte: tokenLimit - estimatedTokens },
      requests: { $lt: requestLimit },
    },
    {
      $inc: { tokensReserved: estimatedTokens, requests: 1 },
    },
    { new: true }
  );
  if (!usage) {
    throw new AppError(429, "AI daily usage limit exceeded");
  }

  return estimatedTokens;
};

export const aiUsageLimiter = (maxOutputTokens) => async (req, res, next) => {
  try {
    req.aiReservedTokens = await reserveAiUsage(
      req.user._id,
      req.body,
      maxOutputTokens
    );
    next();
  } catch (error) {
    next(error);
  }
};
