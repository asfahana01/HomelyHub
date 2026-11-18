import { generateDescription } from "../ai/generateDescription.js";

const generatePropertyDescription = async (req, res) => {
  try {
    const { propertyName, propertyType, roomType, maximumGuest, price } = req.body;

    if (!propertyName || typeof propertyName !== "string" || propertyName.trim().length === 0) {
      return res.status(400).json({
        status: "fail",
        message: "A valid property name is required to generate a description",
      });
    }

    if (propertyName.length > 150) {
      return res.status(400).json({
        status: "fail",
        message: "Property name exceeds maximum allowed length of 150 characters",
      });
    }

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
      message: "Failed to generate property description. Please try again later.",
    });
  }
};

export { generatePropertyDescription };
