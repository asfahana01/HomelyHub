// receve the user's info
//validate the required information
//send the info to out AI trip planner
//calculate the budget per night
// search MongoDB for suitable properties
// send both AI trip plan + matching properties back to the frontend / user

import {Property} from "../models/propertyModel.js"
import {planTrip} from "../ai/tripPlanner.js"

const cleanCity = (text) => text.toLowerCase().replaceAll(" ", "")

const createTripPlan = async(req,res) =>{
  try{
    const{destination, budget, days, people, interests} = req.body

    if(!destination || !budget || !days || !people){
      return res.status(400).json({
        status:"fail",
        message:"Please fill in destination, budget, days, and people"
      })
    }
    const plan = await planTrip({
      destination,
      budget,
      days,
      people, 
      interests : interests || []
    });

    const perNight = Number(budget) / Number(days);
    const city = cleanCity(destination);
    const properties = await Property.find({
      $or:[
        {"address.city":city},
        {"address.state": city},
        {"address.area": city}
      ],
      price:{$lte: perNight},
      maximumGuest:{$gte: Number(people)},
    }).limit(6);
    res.status(200).json({
      status:"success",
      data:{plan, properties, perNight}
    })
  }
  catch(error){
     console.error("TRIP PLANNER ERROR:", error);

  res.status(500).json({
    status: "fail",
    message: error.message || "An error occurred while creating the trip plan"
  });
  }
}

export {createTripPlan}