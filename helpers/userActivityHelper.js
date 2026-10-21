const mongoose = require("mongoose");
const UserActivity = mongoose.model("user_activity");

const logUserActivity = async (
  admin_id,
  organization_id,
  user_id,
  message,
  action,
  ref_id,
  ref_collection,
  description = "",
  session = undefined
) => {
  // Some callers pass a transaction session in place of the description.
  if (description && typeof description === "object" && typeof description.startTransaction === "function") {
    session = description;
    description = "";
  }
  try {
    // console.log(
    //   admin_id,
    //   organization_id,
    //   user_id,
    //   message,
    //   action,
    //   ref_id,
    //   ref_collection,
    //   description,
    //   "check the activity log"
    // );
    // return;
    if (!admin_id || !organization_id || !user_id) {
      throw new Error("Missing required activity log fields");
    }

    await UserActivity.create(
      [{ admin_id, organization_id, user_id, message, action, ref_id, ref_collection, description }],
      session ? { session } : {}
    );

    console.log(`User activity logged: ${action} on ${ref_collection}`);
  } catch (error) {
    console.error("Failed to log user activity:", error.message);
  }
};

module.exports = logUserActivity;
