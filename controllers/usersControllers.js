const mongoose = require("mongoose");
const UsersCollection = mongoose.model("user");
const OrgCollection = mongoose.model("Organization");
const ContactCollection = mongoose.model("Contact");
const ContactPersonCollection = mongoose.model("contactDetails");
const ClientCollection = mongoose.model("clients");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

class usersController {
  async userRegister(req, res) {
    try {
      // console.log("reg", req.body);
      // return;
      const {
        companyName,
        email,
        password,
        phoneNumber,
        country,
        state,
        agreeToTerms,
      } = req.body;

      if (!email || !password || !phoneNumber) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?=.{8,})/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters long and include at least one uppercase letter, one number, and one special character.",
        });
      }

      const existingUser = await UsersCollection.findOne({ email });
      if (existingUser)
        return res.status(400).json({ message: "User already exists" });

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = new UsersCollection({
        company_name: companyName,
        email,
        password: hashedPassword,
        mobile: phoneNumber,
        country,
        state,
        agreement_status: agreeToTerms,
      });
      await newUser.save();
      console.log(newUser._id);
      const token = jwt.sign(
        { userId: newUser._id, role: "admin" },
        process.env.JWT_SECRET,
        {
          expiresIn: "10d",
        }
      );
      const { password: _omit, ...safeUser } = newUser.toObject();
      res.status(ST_CODES.OK).json({
        message: "User registered successfully",
        token,
        data: safeUser,
      });
    } catch (error) {
      console.log("reg error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Server error", error });
    }
  }
  //   async addAssetsRecords(req, res) {
  //     try {
  //       let bData = req.body;
  //       let addAssetsRecords = await queryHelper.insertData(
  //         AssetsRecordCollection,
  //         bData
  //       );
  //       if (addAssetsRecords.status) {
  //         res.status(ST_CODES.OK).send({
  //           status: addAssetsRecords.status,
  //           message: addAssetsRecords.msg,
  //         });
  //       } else {
  //         res.status(ST_CODES.BAD_REQUEST).send({
  //           status: addAssetsRecords.status,
  //           message: addAssetsRecords.msg,
  //         });
  //       }
  //     } catch (err) {
  //       console.log("userRegister error", err);
  //       res
  //         .status(ST_CODES.INTERNAL_SERVER_ERROR)
  //         .send({ message: "Something went wrong" });
  //     }
  //   }
  async userLogin(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Email and password are required" });
      }

      const user = await UsersCollection.findOne({ email });
      if (!user)
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Invalid credentials" });

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch)
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Invalid credentials" });

      const token = jwt.sign(
        { userId: user._id, role: "admin" },
        process.env.JWT_SECRET,
        {
          expiresIn: "10d",
        }
      );
      let orgData = await OrgCollection.findOne({
        admin_id: user._id,
        org_type: "default",
      });
      console.log(orgData, "orgData");
      res.status(ST_CODES.OK).send({
        token,
        ORG_ID: orgData.organization_id,
        user: {
          email: user.email,
          mobile: user.mobile,
          comp_name: user.company_name,
        },
        message: "User login successfully...",
      });
    } catch (error) {
      console.log("login error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Server error", error });
    }
  }
  async fetchUser(req, res) {
    try {
      const token = req.params.token;
      if (!token) {
        return res
          .status(401)
          .json({ message: "No token provided.", success: false });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded || !decoded.userId) {
        return res
          .status(401)
          .json({ message: "Invalid token.", success: false });
      }

      const user = await UsersCollection.findOne({ _id: decoded.userId });
      const organization = await OrgCollection.findOne({ admin_id: user._id });
      if (!user) {
        return res
          .status(401)
          .json({ message: "User not found.", success: false });
      }

      res.status(200).json({
        status: true,
        message: "User authenticated successfully",
        data: {
          id: decoded.userId,
          user: organization,
        },
      });
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Invalid or expired token.", success: false });
    }
  }
  // middleware token checking for customer portal
  async fetchClient(req, res) {
    try {
      console.log("divyaaaaaaaaaa");
      const token = req.params.token;
      if (!token) {
        return res
          .status(401)
          .json({ message: "No token provided.", success: false });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded || !decoded.userId) {
        return res
          .status(401)
          .json({ message: "Invalid token.", success: false });
      }

      const user = await ClientCollection.findOne({ _id: decoded.userId });
      const organization = await OrgCollection.findOne({ admin_id: user._id });
      if (!user) {
        return res
          .status(401)
          .json({ message: "User not found.", success: false });
      }

      res.status(200).json({
        status: true,
        message: "User authenticated successfully",
        data: {
          id: decoded.userId,
          user: organization,
        },
      });
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Invalid or expired token.", success: false });
    }
  }

  async getUserData(req, res) {
    try {
      let admin_id = res.locals.user_id;
      let adminData = await UsersCollection.findOne({ _id: admin_id });
      if (!adminData) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Cannot find admin",
        });
      }
      const { password: _omit, ...safeAdminData } = adminData.toObject();
      return res.status(ST_CODES.OK).send({
        status: true,
        data: safeAdminData,
        message: "Fetched successfully...",
      });
    } catch (error) {
      console.log("getUserData Something went wrong...", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async clientLogin(req, res) {
    try {
      const { email, password, role } = req.body;

      if (!email || !password || !role) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Email and password are required" });
      }

      const user = await ClientCollection.findOne({ email, role: role });
      if (!user)
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Invalid credentials" });

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch)
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Invalid credentials" });

      const token = jwt.sign(
        { userId: user._id, role: "client" },
        process.env.JWT_SECRET,
        {
          expiresIn: "10d",
        }
      );
      let contactData = await ContactCollection.findOne({
        contact_id: user.client_id,
      });
      const { password: _omit, ...safeUser } = user.toObject();
      res.status(ST_CODES.OK).send({
        token,
        org_id: contactData.organization_id,
        data: safeUser,
        message: "User login successfully...",
      });
    } catch (error) {
      console.log("login error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Server error", error });
    }
  }

  async clientRegister(req, res) {
    try {
      const { email, role, password, clientId, clientPersonId } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const existingUser = await ClientCollection.findOne({
        email,
        role: role,
      });
      if (existingUser)
        return res.status(400).json({
          message:
            "The Customer Portal has already been enabled for this email address. Try signing in to the portal instead, or sign up using a different email address.",
        });
      const contact = await ContactPersonCollection.findOne({
        email,
        contact_person_id: clientPersonId,
      });
      if (contact && contact.is_added_in_portal) {
        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?=.{8,})/;
        if (!passwordRegex.test(password)) {
          return res.status(400).json({
            message:
              "Password must be at least 8 characters long and include at least one uppercase letter, one number, and one special character.",
          });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);
        const newUser = new ClientCollection({
          email,
          password: hashedPassword,
          client_id: contact.contact_id,
          client_person_id: contact.contact_person_id,
          role: role,
          status: "active",
          role_formatted: capitalize(role.toString()),
        });
        await newUser.save();
        const updatecontactPerson =
          await ContactPersonCollection.findOneAndUpdate(
            { contact_person_id: contact.contact_person_id },
            {
              is_portal_invitation_accepted: true,
            },
            { new: true }
          );
        const token = jwt.sign(
          { userId: newUser._id, role: "client" },
          process.env.JWT_SECRET,
          {
            expiresIn: "10d",
          }
        );
        let contactData = await ContactCollection.findOne({
          contact_id: newUser.client_id,
        });
        const { password: _omit, ...safeNewUser } = newUser.toObject();
        res.status(ST_CODES.OK).json({
          message: "User registered successfully",
          status: true,
          token,
          org_id: contactData.organization_id,
          data: safeNewUser,
        });
      } else {
        return res.status(404).json({ message: "This account does not exist" });
      }
    } catch (error) {
      console.log("reg error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Server error", error });
    }
  }

  // async checkEmailVaild(req,res){

  // }
}

module.exports = new usersController();
