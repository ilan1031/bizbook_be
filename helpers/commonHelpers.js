exports.generateUniqueId = async (
  collectionName,
  uniqueField,
  digits = 4,
  prefix = ""
) => {
  try {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = String(today.getFullYear()).slice(-2);

    const datePart = `${day}${month}${year}`; // e.g. "290425"
    // const baseId = `${prefix.toUpperCase()}-${datePart}`; // e.g. "PO-290425"
    let baseId;
    if (prefix && prefix.length <= 3) {
      baseId = `${prefix.toUpperCase()}-${datePart}`; // e.g. "PO-290425"
    } else {
      baseId = datePart;
    }

    // Find the last document matching the pattern
    const regexPattern = new RegExp(`^${baseId}\\d{${digits}}$`);
    const lastDoc = await collectionName
      .findOne({ [uniqueField]: { $regex: regexPattern } })
      .sort({ _id: -1 })
      .select(uniqueField);

    // Start counter from 1 if nothing found
    let nextNumber = 1;

    if (lastDoc && lastDoc[uniqueField]) {
      const lastNumber = parseInt(lastDoc[uniqueField].slice(-digits));
      nextNumber = lastNumber + 1;
    }

    const paddedNumber = nextNumber.toString().padStart(digits, "0");

    return `${baseId}${paddedNumber}`; // e.g. "PO-2904250001"
  } catch (error) {
    console.error("Error generating unique ID:", error);
    throw new Error("Failed to generate unique ID");
  }
};
exports.generateOrgUniqueId = async (
  collectionName,
  uniqueField,
  digits = 6
) => {
  try {
    // Find the last inserted document in the collection (sorted by createdAt)
    const lastDataOfCollection = await collectionName
      .findOne()
      .sort({ _id: -1 })
      .select(uniqueField);

    // Default starting ID (based on number of digits)
    let newUniqueId = parseInt("1".padEnd(digits, "0")); // Example: 100000 for 6 digits

    if (lastDataOfCollection && lastDataOfCollection[uniqueField]) {
      let lastIdNumber = parseInt(lastDataOfCollection[uniqueField]);
      let newIdNumber = lastIdNumber + 1;

      // Ensure new ID follows the required digit format
      let maxId = parseInt("9".repeat(digits)); // Example: 999999 for 6 digits
      if (newIdNumber > maxId) {
        throw new Error("Generated ID exceeded the allowed digit limit");
      }

      newUniqueId = newIdNumber;
    }

    return newUniqueId.toString().padStart(digits, "0"); // Ensures fixed digit format
  } catch (error) {
    console.error("Error generating unique ID:", error);
    throw new Error("Failed to generate unique ID");
  }
};
exports.formatDateString = (inputDateStr) => {
  if (!inputDateStr) return "";
  const date = new Date(inputDateStr);
  if (isNaN(date)) return inputDateStr; // return as is if invalid

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
};
exports.formatRupee = (value) => {
  if (value === null || value === undefined || value === "") return "";

  const num = Number(value);
  if (isNaN(num)) return value; // return as-is if not a valid number

  // Format using Indian numbering system
  return (
    "₹" +
    num.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
};
exports.formatRupees = (value) => {
  if (value === null || value === undefined || value === "") return "";

  const num = Number(value);
  if (isNaN(num)) return value; // return as-is if not a valid number

  // Format using Indian numbering system
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
