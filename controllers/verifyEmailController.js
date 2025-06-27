const mongoose = require("mongoose");
const contactPerson = require("../model/contactPerson");
const ClientCollection = mongoose.model("clients");

class VerifyEmailController {
    async verifyEmail(req, res) {
        try {
            const { email, organization_id } = req.body;

            if (!email) {
                return res.status(201).json({ message: "Email is required" });
            }

            const user = await ClientCollection.findOne({ email });

            if (user) {
                const checkOrgData = await contactPerson.findOne({organization_id,contact_id:user.client_id,contact_person_id:user.client_person_id});
                if(checkOrgData){
                    return res.status(200).json({ message: "User Found" });
                }else{
                    return res.status(202).json({ message: "User is associate with another organization." });
                }     
            } else {
                return res.status(201).json({ message: "User doesn't exist" });
            }
        } catch (error) {
            console.error("Error verifying email:", error);
            return res.status(500).json({ message: "Internal Server Error" });
        }
    }
}

module.exports = new VerifyEmailController();
