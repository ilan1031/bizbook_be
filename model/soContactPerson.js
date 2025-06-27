const mongoose = require("mongoose");

const contactPersonSchema = new mongoose.Schema(
  {
    contact_person_id: { type: String, unique: true}, // Unique contactPerson ID
    contact_id: { type: String },
    organization_id: { type: String },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    salutation: { type: String },
    first_name: { type: String},
    last_name: { type: String },
    email: { type: String},
    phone: { type: String },
    mobile: { type: String },
    skype: { type: String },
    department: { type: String },
    designation: { type: String },
    can_invite:{type:Boolean, default: false},
    is_primary_contact: {type:Boolean, default:false},
    is_added_in_portal:{type:Boolean,default:false},
    is_portal_invitation_accepted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("contactDetails", contactPersonSchema);

