const mongoose = require("mongoose");

const emailLogSchema = new mongoose.Schema(
  {
    email_log_id: {
      type: String,
      required: true,
    //   unique: true,
    },
    from_email: {
      type: String,
      required: true,
    },
    to_email: {
      type: String,
      required: true,
    },
    cc_emails: {
      type: String,
      default: "",
    },
    bcc_emails: {
      type: String,
      default: "",
    },
    subject: {
      type: String,
      // required: true,
    },
    body: {
      type: String,
      required: true,
    },
    attachment_names: {
      type: [String],
      default: [],
    },
    order_id: {
      type: String,
    },
    email_type: {
      type: String,
    },
    organization_id: {
      type: String,
      required: true,
    },
    contact_id: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    message_id: {
      type: String,
    },
    error_message: {
      type: String,
    },
    created_by: {
      type: String,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },

  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

module.exports = mongoose.model("POEmailLog", emailLogSchema);