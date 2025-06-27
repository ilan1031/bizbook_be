const mongoose = require("mongoose");
const userSchema = new mongoose.Schema(
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
    mobile: { type: String, required: true },
    company_name: {
      type: String,
    },
    country: {
      type: String,
    },
    state: {
      type: String,
    },
    agreement_status: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("user", userSchema);
