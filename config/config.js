const Mongoose = require('mongoose');
const schema = Mongoose.Schema;
const model = Mongoose.model;
const ObjectId = Mongoose.Schema.Types.ObjectId;

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, '../.env') })
module.exports = {
    HOST_URL: process.env.DB_Coll,
    PORT: process.env.APP_PORT,
    schema,
    ObjectId,
    model
}