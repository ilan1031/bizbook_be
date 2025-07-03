const apiHandler = require("../handler/api-handler");

const authClientMiddleware = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res
      .status(401)
      .json({ message: "Token verification failed", success: false });
  }

  let userToken = token.split(" ")[1];
  if (!userToken) {
    return res
      .status(401)
      .json({ message: "Token verification failed", success: false });
  }

  try {
    const response = await apiHandler.getClientInformation(userToken);

    if (!response || !response.data || !response.data.status) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid token.", success: false });
    }
    // console.log(response.data.data.user)
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

module.exports = authClientMiddleware;
