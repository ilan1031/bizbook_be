const mongoose = require("mongoose");

exports.findData = async (collection, where, gets, sorts, limits, page) => {
  try {
    const sorlen = Object.keys(sorts).length;
    if (sorlen != 0 && limits != 0) {
      const resData = await collection
        .find(where, gets)
        .sort(sorts)
        .limit(limits * 1)
        .skip((page - 1) * limits);
      if (!resData) {
        return { status: false, msg: "record not found!" };
      }
      return { status: true, msg: resData };
    } else if (sorlen != 0) {
      const resData = await collection.find(where, gets).sort(sorts);
      if (!resData) {
        return { status: false, msg: "record not found!" };
      }
      return { status: true, msg: resData };
    } else if (limits != 0) {
      const resData = await collection
        .find(where, gets)
        .limit(limits * 1)
        .skip((page - 1) * limits);
      if (!resData) {
        return { status: false, msg: "record not found!" };
      }
      return { status: true, msg: resData };
    } else {
      const resData = await collection.find(where, gets);
      if (!resData) {
        return { status: false, msg: "record not found!" };
      }
      return { status: true, msg: resData };
    }
  } catch (e) {
    console.log("findData", e, collection, where, gets, sorts, limits, page);
    return { status: false, msg: e.message };
  }
};
exports.findDataWithPopulate = async (
  collection,
  where,
  gets,
  sorts,
  limits,
  page,
  populateFields = []
) => {
  try {
    let query = collection.find(where, gets);

    // Apply Sorting
    if (Object.keys(sorts).length !== 0) {
      query = query.sort(sorts);
    }

    // Apply Pagination
    if (limits !== 0) {
      query = query.limit(limits).skip((page - 1) * limits);
    }

    // Apply Population if provided
    if (Array.isArray(populateFields) && populateFields.length > 0) {
      populateFields.forEach((field) => {
        console.log("field", field);
        query = query.populate(field);
      });
    }

    const resData = await query;

    if (!resData || resData.length === 0) {
      return { status: false, msg: [] };
    }

    return { status: true, msg: resData };
  } catch (e) {
    console.log("findData Error:", e, {
      collection,
      where,
      gets,
      sorts,
      limits,
      page,
      populateFields,
    });
    return { status: false, msg: e.message };
  }
};
exports.insertData = async (collection, values) => {
  try {
    const inslen = Object.keys(values).length;
    if (inslen != 0) {
      const insData = await collection.create(values);
      if (!insData) {
        return { status: false, msg: "not inserted" };
      }
      return { status: true, msg: insData };
    } else {
      return { status: false, msg: "not inserted" };
    }
  } catch (e) {
    if (e.code == 11000) {
      const fieldNames = Object.keys(e.keyPattern);
      const duplicateFields = fieldNames.map((fieldName) => {
        return `${fieldName} ${e.keyValue[fieldName]} is already taken`;
      });
      return { status: false, msg: duplicateFields.join("") };
    }
    return { status: false, msg: e.message };
  }
};
exports.countDocuments = async (collection, where) => {
  try {
    const count = await collection.countDocuments(where);
    return count;
  } catch (e) {
    console.error("countDocuments Error:", e.message);
    return 0; // Return 0 if there's an error
  }
};
