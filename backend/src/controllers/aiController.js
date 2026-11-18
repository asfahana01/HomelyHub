import { generateDescription } from "../ai/generateDescription.js";

const generatePropertyDescription = async (req, res) => {
  try {
    const description = await generateDescription(req.body);

    res.status(200).json({
      status: "success",
      data: {
        description,
      },
    });
  } catch (error) {
    console.error("AI DESCRIPTION ERROR:", error);

    res.status(500).json({
      status: "fail",
      message: "Failed to generate property description",
    });
  }
};

export { generatePropertyDescription };