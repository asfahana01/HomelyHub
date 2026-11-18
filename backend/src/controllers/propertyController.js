import { Property } from "../models/propertyModel.js";
import { Booking } from "../models/bookingModel.js";
import { APIFeatures } from "../utils/APIFeatures.js";
import imagekit from "../utils/ImagekitIO.js";

// Helper for admin audit logging (no sensitive secrets logged)
const auditLog = (action, details) => {
  const timestamp = new Date().toISOString();
  console.log(`[AUDIT LOG] ${timestamp} | ACTION: ${action} | DETAILS:`, JSON.stringify(details));
};

// 1. GET ALL PROPERTIES - Public browsing with filtering, searching, and pagination
const getProperties = async (req, res) => {
  try {
    const baseQuery = Property.find({
      isArchived: { $ne: true },
      isActive: { $ne: false },
    });

    const features = new APIFeatures(baseQuery, req.query)
      .filter()
      .search()
      .paginate();

    const doc = await features.query;

    res.status(200).json({
      status: "success",
      no_of_responses: doc.length,
      data: doc,
    });
  } catch (error) {
    console.error("Error searching properties: ", error);
    res.status(500).json({ status: "error", message: "Failed to retrieve properties" });
  }
};

// 2. GET SINGLE PROPERTY BY ID - Public
const getProperty = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isArchived: { $ne: true },
    });

    if (!property) {
      return res.status(404).json({
        status: "fail",
        message: "Property not found",
      });
    }

    res.status(200).json({
      status: "success",
      data: property,
    });
  } catch (error) {
    res.status(404).json({
      status: "fail",
      message: "Property not found",
    });
  }
};

// 3. CREATE PROPERTY - Admin Only
const createProperty = async (req, res) => {
  try {
    const {
      propertyName,
      description,
      propertyType,
      roomType,
      extraInfo,
      address,
      amenities,
      checkInTime,
      checkOutTime,
      maximumGuest,
      price,
      images,
    } = req.body;

    // Validation
    if (!propertyName || !description || !price || !maximumGuest) {
      return res.status(400).json({
        status: "fail",
        message: "Property name, description, price, and maximum guests are required.",
      });
    }

    if (!images || !Array.isArray(images) || images.length < 6 || images.length > 15) {
      return res.status(400).json({
        status: "fail",
        message: "Please provide between 6 and 15 images for the property listing.",
      });
    }

    const uploadedImages = [];

    // Process and validate each image
    for (const image of images) {
      const imgUrl = image.url;
      if (!imgUrl) continue;

      const isHttp = /^https?:\/\//i.test(imgUrl);
      const isBase64 = /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imgUrl);

      if (!isHttp && !isBase64) {
        return res.status(400).json({
          status: "fail",
          message: "All images must be valid HTTP(S) links or JPEG/PNG/WEBP data URLs.",
        });
      }

      // If base64, limit size to ~5MB
      if (isBase64 && imgUrl.length > 5 * 1024 * 1024 * 1.37) {
        return res.status(400).json({
          status: "fail",
          message: "Individual image exceeds maximum size of 5MB.",
        });
      }

      if (isBase64) {
        const result = await imagekit.upload({
          file: imgUrl,
          fileName: `property_${Date.now()}.jpg`,
          folder: "property_images",
        });
        uploadedImages.push({ url: result.url, public_id: result.fileId });
      } else {
        uploadedImages.push({ url: imgUrl, public_id: image.public_id || `img_${Date.now()}` });
      }
    }

    if (uploadedImages.length < 6) {
      return res.status(400).json({
        status: "fail",
        message: "A minimum of 6 valid images are required.",
      });
    }

    const property = await Property.create({
      propertyName,
      description,
      propertyType,
      roomType,
      extraInfo,
      address,
      amenities,
      checkInTime,
      checkOutTime,
      maximumGuest: Number(maximumGuest),
      price: Number(price),
      images: uploadedImages,
      userId: req.user._id,
      isActive: true,
      isArchived: false,
    });

    auditLog("PROPERTY_CREATED", {
      adminId: req.user._id,
      propertyId: property._id,
      propertyName: property.propertyName,
    });

    res.status(201).json({ status: "success", data: { data: property } });
  } catch (error) {
    console.error("Error creating property:", error);
    res.status(400).json({ status: "fail", message: error.message });
  }
};

// 4. UPDATE PROPERTY - Admin Only
const updateProperty = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const property = await Property.findById(propertyId);

    if (!property) {
      return res.status(404).json({
        status: "fail",
        message: "Property not found",
      });
    }

    const allowedUpdates = [
      "propertyName",
      "description",
      "propertyType",
      "roomType",
      "extraInfo",
      "address",
      "amenities",
      "checkInTime",
      "checkOutTime",
      "maximumGuest",
      "price",
      "isActive",
    ];

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        property[field] = req.body[field];
      }
    });

    // If new images provided
    if (req.body.images && Array.isArray(req.body.images)) {
      if (req.body.images.length < 6 || req.body.images.length > 15) {
        return res.status(400).json({
          status: "fail",
          message: "Property must have between 6 and 15 images.",
        });
      }
      property.images = req.body.images;
    }

    await property.save();

    auditLog("PROPERTY_UPDATED", {
      adminId: req.user._id,
      propertyId: property._id,
      updatedFields: Object.keys(req.body).filter((k) => allowedUpdates.includes(k)),
    });

    res.status(200).json({
      status: "success",
      data: property,
    });
  } catch (error) {
    res.status(400).json({
      status: "fail",
      message: error.message,
    });
  }
};

// 5. DELETE PROPERTY (Safe Deletion Policy) - Admin Only
const deleteProperty = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const property = await Property.findById(propertyId);

    if (!property) {
      return res.status(404).json({
        status: "fail",
        message: "Property not found",
      });
    }

    // Check for active or upcoming bookings
    const activeBookings = await Booking.find({
      property: propertyId,
      paid: true,
      toDate: { $gte: new Date() },
    });

    if (activeBookings.length > 0) {
      // Safe deletion: Property has active/upcoming bookings, so archive it to preserve booking and financial history
      property.isArchived = true;
      property.isActive = false;
      await property.save();

      auditLog("PROPERTY_ARCHIVED_DUE_TO_ACTIVE_BOOKINGS", {
        adminId: req.user._id,
        propertyId: property._id,
        activeBookingsCount: activeBookings.length,
      });

      return res.status(200).json({
        status: "success",
        message: "Property has active upcoming bookings and has been safely archived instead of permanently deleted to preserve guest reservations.",
        archived: true,
      });
    }

    // If no active bookings, archive/soft-delete to preserve historical audit trail
    property.isArchived = true;
    property.isActive = false;
    await property.save();

    auditLog("PROPERTY_ARCHIVED", {
      adminId: req.user._id,
      propertyId: property._id,
    });

    res.status(200).json({
      status: "success",
      message: "Property listing successfully archived and removed from public listings.",
    });
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: "Failed to delete or archive property",
    });
  }
};

// 6. GET ADMIN PROPERTIES - Returns all platform properties for admin management
const getUsersProperties = async (req, res) => {
  try {
    const properties = await Property.find({
      isArchived: { $ne: true },
    }).sort("-createdAt");

    res.status(200).json({
      status: "success",
      data: properties,
    });
  } catch (error) {
    res.status(404).json({ status: "fail", message: error.message });
  }
};

export {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
  getUsersProperties,
};
