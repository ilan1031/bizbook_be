// Makes sure the superadmin account from the environment exists and is
// active. Runs once on startup after the database connects.
//   SUPERADMIN_EMAIL    - required to enable seeding
//   SUPERADMIN_PASSWORD - used only when the account is first created
//   SUPERADMIN_MOBILE   - optional; receives new sign-up alerts by SMS
// An existing account is promoted to superadmin but its password is left
// alone, unless SUPERADMIN_RESET_PASSWORD=true.
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ensureSuperadmin = async () => {
  const email = String(process.env.SUPERADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email) {
    console.warn("SUPERADMIN_EMAIL is not set - no superadmin account was ensured.");
    return;
  }

  require("../model/usersSchema");
  const Users = mongoose.model("user");
  const existing = await Users.findOne({ email });

  if (!existing) {
    if (!password) {
      console.warn("SUPERADMIN_PASSWORD is not set - superadmin account was not created.");
      return;
    }
    await Users.create({
      email,
      password: await bcrypt.hash(password, 10),
      mobile: process.env.SUPERADMIN_MOBILE || "0000000000",
      company_name: "Super Admin",
      role: "superadmin",
      status: "active",
      agreement_status: true,
      approved_at: new Date(),
    });
    console.log(`Superadmin account created for ${email}`);
    return;
  }

  const update = { role: "superadmin", status: "active" };
  if (process.env.SUPERADMIN_MOBILE) update.mobile = process.env.SUPERADMIN_MOBILE;
  if (process.env.SUPERADMIN_RESET_PASSWORD === "true" && password) {
    update.password = await bcrypt.hash(password, 10);
    console.log("Superadmin password reset from SUPERADMIN_PASSWORD");
  }
  await Users.updateOne({ _id: existing._id }, { $set: update });
};

module.exports = { ensureSuperadmin };
