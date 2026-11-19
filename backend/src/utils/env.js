export const REQUIRED_ENV_VARS = [
  "MONGO_URI",
  "JWT_SECRET",
  "COOKIE_SECRET",
  "FRONTEND_URL",
  "ORIGIN_ACCESS_URL",
  "MAILTRAP_SMTP_HOST",
  "MAILTRAP_SMTP_USER",
  "MAILTRAP_SMTP_PASS",
  "IMAGE_PUBLICKEY",
  "IMAGE_PRIVATEKEY",
  "IMAGEKIT_URLENDPOINT",
  "GROQ_API_KEY",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
];

export const getEnvironmentIssues = (env = process.env) => {
  const issues = REQUIRED_ENV_VARS.filter((key) => {
    const value = env[key];
    return (
      typeof value !== "string" ||
      value.trim() === "" ||
      /your_|<[^>]+>/i.test(value.trim())
    );
  });

  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) issues.push("JWT_SECRET");
  if (env.COOKIE_SECRET && env.COOKIE_SECRET.length < 32) {
    issues.push("COOKIE_SECRET");
  }
  if (env.MONGO_URI && !/^mongodb(\+srv)?:\/\//i.test(env.MONGO_URI)) {
    issues.push("MONGO_URI");
  }
  return [...new Set(issues)];
};

export const validateEnvironment = (env = process.env) => {
  const issues = getEnvironmentIssues(env);
  if (issues.length) {
    throw new Error(
      `Missing or invalid required environment variables: ${issues.join(", ")}`
    );
  }
};
