const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const usersCollection = mongoose.model("user");
const ClientCollection = mongoose.model("clients");

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization; // Extract token from header 'x-auth-token'
  // console.log(token,"tokenget")
  if (!token) {
    return res
      .status(401)
      .json({ message: "No token provided, access denied.", success: false });
  }
  let userToken = token.split(" ")[1];
  // console.log("token", userToken);

  if (!userToken) {
    return res
      .status(401)
      .json({ message: "No token provided, access denied.", success: false });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(userToken, process.env.JWT_SECRET);
    // console.log(decoded,"decodeddata")
    let user;
    if (decoded.role === "client") {
      // console.log(1);
      user = await ClientCollection.findOne({ _id: decoded.userId });
    } else {
      // console.log(2);
      user = await usersCollection.findOne({ _id: decoded.userId });
    }
    // console.log("It", user);
    if (user) {
      res.locals.user_id = decoded.userId;
      res.locals.role = decoded.role;
      res.user = user;
      // Proceed to next middleware or route handler
      next();
    } else {
      return res.status(401).json({
        message: "No token provided, cannot find user",
        success: false,
      });
    }
  } catch (error) {
    console.error("Token verification failed:", error);
    res
      .status(400)
      .json({ message: "Invalid or expired token.", success: false });
  }
};

module.exports = authMiddleware;
