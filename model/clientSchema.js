const mongoose = require("mongoose");
const clientSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      match: [
        /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\. [0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
        "Please add a valid email address.",
      ],
      required: [true, "Please enter Email Address"],
      unique: true,
      lowercase: true,
      dropDups: true,
    },
    password: {
      type: String,
      required: true,
    },
    status:{
      type: String,
    },
    role: {
      type:String,
      default:"admin",
    },
    role_formatted: {
      type:String,
      default:"Admin",
    },
    client_id: {
      type:String,
    },
    client_person_id: {
      type:String,
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("clients", clientSchema);
