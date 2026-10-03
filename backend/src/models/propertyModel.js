import slugify from 'slugify';
import mongoose from 'mongoose';

const propertySchema = new mongoose.Schema({
  propertyName:{
    type:String,
    required:[true,"Please Enter your property name"]
  },
  description:{
    type:String,
    required:[true,"Please add information about your property"]
  },
  extraInfo:{
    type:String,
    default:"checking on time. good services."
  },
  propertyType:{
    type:String,
    enum:["House","Flat", "Guest House", "Hotel", "villa", "Resort"],
    default:"House"
  },
  roomType:{
    type:String,
    enum:["Anytype","Room", "Entire Home"],
    default:"Anytype"
  },
  maximumGuest:{
    type:Number,
    required:[true,"Please give the maximum number of Guests that can occupy"]
  },
  amenities:[
    {
      name:{
        type:String,
        required:true,
        enum:[
          "wifi",
          "Kitchen",
          "Ac",
          "Washing Machine",
          "Tv",
          "Pool",
          "Free Parking"
        ]
      },
      icon:{
        type:String,
        required:true
      }
    }
  ],
  images:{
    type:[
      {
        public_id:{
          type:String
        },
        url:{
          type:String,
          required:true
        }
      }
    ],
    validate:{
      validator:function(arr){
        return arr.length >=6;
    },
    message:"The images must be at least 6"
  }
  },
  price:{
    type:Number,
    required:[true,"please enter the price per night value"],
    default:500
  },
  address:{
    area:String,
    state:String,
    city:String,
    pincode:Number
  },
  currentBookings:[
    {
      bookingId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Booking"
      },
      fromdate:{
      type:Date
    },
    todate:{
    type:Date
    },
    userId:{
      type:mongoose.Schema.Types.ObjectId,
      ref:"User"
    }
    }
  ],
  userId:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"User"
  },
  slug:String,

  checkInTime:{ type:String, default:"12:00 PM"},

  checkOutTime:{ type:String, default:"12:00 PM"},

})

propertySchema.pre("save", function(next){
  this.slug = slugify(this.propertyName, {lower:true});
  next();
})
propertySchema.pre("save", function(next){
  this.address.city = this.address.city.toLowerCase().replaceAll(" ", "")
  next();
})

//const property = mongoose.model("Property", propertySchema);
const Property = mongoose.model.Property || mongoose.model("Property",propertySchema)
export{Property};