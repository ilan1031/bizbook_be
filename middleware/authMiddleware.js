const axios = require("axios");
const apiHandler = require("../handler/api-handler");
const jwt = require("jsonwebtoken");

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res
      .status(401)
      .json({ message: "Token verification failed", success: false });
  }

  let userToken = token.split(" ")[1];
  console.log(userToken);
  if (!userToken) {
    return res
      .status(401)
      .json({ message: "Token verification failed", success: false });
  }

  try {
    const decode = jwt.verify(userToken, process.env.JWT_SECRET);
    let response;
    if (decode.role === "client") {
      // console.log("hiiiiiiiii");
      response = await apiHandler.getClientInformation(userToken);
      // console.log(response, "responseresponseresponseresponseresponse");
    } else {
      // console.log("hiiiiiiiii11111111111111");
      response = await apiHandler.getUserInformation(userToken);
    }
    if (!response || !response.data || !response.data.status) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid token.", success: false });
    }
    // console.log(response.data.data);
    res.user = response.data.data.user; // Store user info in res.user
    res.locals.user_id = response.data.data.id;
    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return res
      .status(400)
      .json({ message: "Invalid or expired token.", success: false });
  }
};

module.exports = authMiddleware;
