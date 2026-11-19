import { z } from "zod";
import { parseAiTripOutput } from "../utils/validation.js";

export const escapePromptText = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const parseTripPlan = (content, expectedDays) => {
  const parsed = JSON.parse(content);
  return parseAiTripOutput(parsed, expectedDays);
};

export const parsePropertyDescription = (content) =>
  z.string()
    .trim()
    .min(200)
    .max(2000)
    .parse(content);
