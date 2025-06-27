const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  // Special case for organization not found
  ORG_NOT_FOUND: 201, // Using 201 to indicate success but org not found
  // Add other codes as needed
};
module.exports = STATUS_CODES;
