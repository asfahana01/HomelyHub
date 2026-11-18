import slugify from "slugify";
import mongoose from "mongoose";

const propertySchema = new mongoose.Schema(
  {
    propertyName: {
      type: String,
      required: [true, "Please Enter your property name"],
      trim: true,
      maxLength: [150, "Property name cannot exceed 150 characters"],
    },
    description: {
      type: String,
      required: [true, "Please add information about your property"],
    },
    extraInfo: {
      type: String,
      default: "checking on time. good services.",
    },
    propertyType: {
      type: String,
      enum: ["House", "Flat", "Guest House", "Hotel", "villa", "Resort"],
      default: "House",
    },
    roomType: {
      type: String,
      enum: ["Anytype", "Room", "Entire Home"],
      default: "Anytype",
    },
    maximumGuest: {
      type: Number,
      required: [
        true,
        "Please give the maximum number of Guests that can occupy",
      ],
      min: [1, "Maximum guests must be at least 1"],
    },
    amenities: [
      {
        name: {
          type: String,
          required: true,
          enum: [
            "wifi",
            "Kitchen",
            "Ac",
            "Washing Machine",
            "Tv",
            "Pool",
            "Free Parking",
          ],
        },
        icon: {
          type: String,
          required: true,
        },
      },
    ],
    images: {
      type: [
        {
          public_id: {
            type: String,
          },
          url: {
            type: String,
            required: true,
          },
        },
      ],
      validate: {
        validator: function (arr) {
          return arr && arr.length >= 6 && arr.length <= 15;
        },
        message: "The property images must be between 6 and 15 images",
      },
    },
    price: {
      type: Number,
      required: [true, "please enter the price per night value"],
      min: [1, "Price must be greater than 0"],
      default: 500,
    },
    address: {
      area: { type: String, trim: true },
      state: { type: String, trim: true },
      city: { type: String, trim: true },
      pincode: { type: Number },
    },
    currentBookings: [
      {
        bookingId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Booking",
        },
        fromDate: {
          type: Date,
        },
        toDate: {
          type: Date,
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    slug: String,
    checkInTime: { type: String, default: "12:00 PM" },
    checkOutTime: { type: String, default: "12:00 PM" },
    isArchived: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

propertySchema.index({ "address.city": 1 });
propertySchema.index({ userId: 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ isArchived: 1, isActive: 1 });

propertySchema.pre("save", function () {
  if (this.propertyName) {
    this.slug = slugify(this.propertyName, { lower: true });
  }
  if (this.address && this.address.city) {
    this.address.city = this.address.city.toLowerCase().replaceAll(" ", "");
  }
});

const Property =
  mongoose.models.Property || mongoose.model("Property", propertySchema);

export { Property };
