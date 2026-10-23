const Mongoose = require('mongoose');
const dns = require("dns");
const config = require("./config")

// A mongodb+srv:// address needs a DNS SRV lookup, which some networks' DNS
// servers refuse ("querySrv ECONNREFUSED"). DB_DNS_SERVERS=8.8.8.8,1.1.1.1
// makes Node ask those servers instead.
const dnsServers = String(process.env.DB_DNS_SERVERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

const mongoDbUrl = {
    DB_HOST: `${config.HOST_URL}`
}

Mongoose
.connect(mongoDbUrl.DB_HOST)
.then(() => {
    console.log('successfully connected to MongoDB')
    return require("../helpers/superadminSeed").ensureSuperadmin()
})
.catch((err) => console.log("Database can't be connected: " + err));
