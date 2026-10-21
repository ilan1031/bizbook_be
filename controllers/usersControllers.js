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
const crypto = require("crypto");
const { getClientIp, PAGES } = require("../helpers/rbac");
const { sendSms, isConfigured: smsConfigured } = require("../helpers/smsHelper");

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// SMS one-time code before a new IP is added to a user's allowed list.
// On when LOGIN_OTP_ENABLED=true and an SMS provider is configured.
const loginOtpEnabled = () =>
  process.env.LOGIN_OTP_ENABLED === "true" && smsConfigured();

const hashOtp = (code) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(String(code)).digest("hex");

const findSuperadmin = () => UsersCollection.findOne({ role: "superadmin" }).lean();

const notifySuperadminOfSignup = async (newUser) => {
  const admin = await findSuperadmin();
  const to = process.env.SUPERADMIN_MOBILE || admin?.mobile;
  if (!to) return;
  await sendSms(
    to,
    `BizBooks: new sign-up ${newUser.email} (${newUser.company_name || "no company"}) is waiting for your approval.`
  );
};

// Issues the session token once every check has passed.
const completeLogin = async (req, res, user) => {
  const ip = getClientIp(req);
  const now = new Date();
  const entry = (user.allowed_ips || []).find((e) => e.ip === ip);
  if (entry) entry.last_login_at = now;
  user.last_login_at = now;
  user.login_otp = undefined;
  await user.save();

  const token = jwt.sign({ userId: user._id, role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: "10d",
  });
  const orgData =
    (await OrgCollection.findOne({ admin_id: user._id, org_type: "default" }).lean()) ||
    (await OrgCollection.findOne({ admin_id: user._id }).lean());

  return res.status(ST_CODES.OK).send({
    token,
    ORG_ID: orgData ? orgData.organization_id : null,
    needs_org_setup: !orgData,
    user: {
      email: user.email,
      mobile: user.mobile,
      comp_name: user.company_name,
      role: user.role,
    },
    message: "User login successfully...",
  });
};

const startLoginOtp = async (req, res, user, ip) => {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  user.login_otp = {
    code_hash: hashOtp(code),
    ip,
    expires_at: new Date(Date.now() + OTP_TTL_MS),
    attempts: 0,
  };
  await user.save();

  const sent = await sendSms(
    user.mobile,
    `BizBooks: your sign-in code is ${code}. It expires in 5 minutes. Don't share it with anyone.`,
    { otp: code }
  );
  if (!sent.ok) {
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
      code: "OTP_SEND_FAILED",
      message: "We couldn't send the sign-in code by SMS. Try again or contact your administrator.",
    });
  }

  const otpSession = jwt.sign(
    { userId: user._id, ip, purpose: "login-otp" },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
  const mobile = String(user.mobile || "");
  return res.status(ST_CODES.OK).json({
    otp_required: true,
    otp_session: otpSession,
    mobile_hint: mobile ? `******${mobile.slice(-4)}` : "",
    message: "This is a new device or network. Enter the code we sent to your mobile.",
  });
};

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
      const normalizedEmail = String(email).trim().toLowerCase();
      const mobile = String(phoneNumber).replace(/\D/g, "");
      if (mobile.length < 10) {
        return res.status(400).json({ message: "Enter a valid mobile number" });
      }

      const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?=.{8,})/;
      if (!passwordRegex.test(String(password))) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters long and include at least one uppercase letter, one number, and one special character.",
        });
      }

      const existingUser = await UsersCollection.findOne({ email: normalizedEmail });
      if (existingUser)
        return res.status(400).json({ message: "User already exists" });

      const hashedPassword = await bcrypt.hash(String(password), 10);

      // New accounts wait for superadmin approval and get no pages until the
      // superadmin grants them. The sign-up IP becomes their first allowed IP.
      const signupIp = getClientIp(req);
      const newUser = new UsersCollection({
        company_name: companyName,
        email: normalizedEmail,
        password: hashedPassword,
        mobile,
        country,
        state,
        agreement_status: agreeToTerms,
        role: "user",
        status: "pending",
        permissions: {},
        allowed_ips: signupIp
          ? [{ ip: signupIp, user_agent: String(req.headers["user-agent"] || "").slice(0, 200) }]
          : [],
      });
      await newUser.save();

      notifySuperadminOfSignup(newUser).catch(() => {});

      res.status(ST_CODES.CREATED).json({
        status: "pending",
        message:
          "Account created. An administrator needs to approve it before you can sign in.",
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
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Email and password are required" });
      }

      // Accept an email address or a 10-digit mobile number.
      const login = String(email).trim().toLowerCase();
      const user = await UsersCollection.findOne(
        login.includes("@") ? { email: login } : { mobile: login.replace(/\D/g, "") }
      );
      if (!user || !(await bcrypt.compare(String(password), user.password)))
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Invalid credentials" });

      if (user.role !== "superadmin") {
        if (user.status !== "active") {
          return res.status(ST_CODES.FORBIDDEN).json({
            code: user.status === "inactive" ? "ACCOUNT_INACTIVE" : "ACCOUNT_PENDING",
            message:
              user.status === "inactive"
                ? "Your account has been deactivated. Contact your administrator."
                : "Your account is waiting for administrator approval.",
          });
        }

        const ip = getClientIp(req);
        const known = (user.allowed_ips || []).find((entry) => entry.ip === ip);
        if (!known) {
          if ((user.allowed_ips || []).length >= (user.ip_limit ?? 2)) {
            return res.status(ST_CODES.FORBIDDEN).json({
              code: "IP_LIMIT_REACHED",
              message: `You can only sign in from ${user.ip_limit ?? 2} devices/networks. Ask your administrator to remove an old one.`,
            });
          }
          if (loginOtpEnabled()) {
            return startLoginOtp(req, res, user, ip);
          }
          user.allowed_ips.push({ ip, user_agent: String(req.headers["user-agent"] || "").slice(0, 200) });
        }
      }

      return completeLogin(req, res, user);
    } catch (error) {
      console.log("login error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Server error", error });
    }
  }
  // Second login step for a new IP: checks the SMS code, then remembers the IP.
  async verifyLoginOtp(req, res) {
    try {
      const { otp_session, otp } = req.body || {};
      let session;
      try {
        session = jwt.verify(String(otp_session || ""), process.env.JWT_SECRET);
      } catch (e) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          code: "OTP_EXPIRED",
          message: "The sign-in code has expired. Please sign in again.",
        });
      }
      const ip = getClientIp(req);
      if (session.purpose !== "login-otp" || session.ip !== ip) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          code: "OTP_INVALID",
          message: "Please sign in again from this device.",
        });
      }

      const user = await UsersCollection.findById(session.userId);
      const pending = user?.login_otp;
      if (!user || user.status !== "active" || !pending?.code_hash || pending.ip !== ip) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          code: "OTP_INVALID",
          message: "Please sign in again.",
        });
      }
      if (new Date(pending.expires_at) < new Date() || pending.attempts >= OTP_MAX_ATTEMPTS) {
        user.login_otp = undefined;
        await user.save();
        return res.status(ST_CODES.BAD_REQUEST).json({
          code: "OTP_EXPIRED",
          message: "The sign-in code has expired or was entered wrongly too many times. Please sign in again.",
        });
      }

      const expected = Buffer.from(pending.code_hash, "hex");
      const given = Buffer.from(hashOtp(String(otp || "").trim()), "hex");
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
        user.login_otp.attempts = (pending.attempts || 0) + 1;
        user.markModified("login_otp");
        await user.save();
        return res.status(ST_CODES.BAD_REQUEST).json({
          code: "OTP_WRONG",
          message: `That code isn't right. ${OTP_MAX_ATTEMPTS - user.login_otp.attempts} attempt(s) left.`,
        });
      }

      // Re-check the limit: another device may have been added meanwhile.
      if (!(user.allowed_ips || []).some((e) => e.ip === ip)) {
        if ((user.allowed_ips || []).length >= (user.ip_limit ?? 2)) {
          return res.status(ST_CODES.FORBIDDEN).json({
            code: "IP_LIMIT_REACHED",
            message: "Your device limit has been reached. Ask your administrator to remove an old one.",
          });
        }
        user.allowed_ips.push({ ip, user_agent: String(req.headers["user-agent"] || "").slice(0, 200) });
      }
      return completeLogin(req, res, user);
    } catch (error) {
      console.log("verifyLoginOtp error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
  }

  // The signed-in user's access: role, status, permissions and the page catalog.
  async getMe(req, res) {
    try {
      const user = await UsersCollection.findById(res.locals.user_id)
        .select("email mobile company_name role status permissions ip_limit allowed_ips")
        .lean();
      if (!user) return res.status(ST_CODES.NOT_FOUND).json({ message: "User not found" });
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          email: user.email,
          mobile: user.mobile,
          company_name: user.company_name,
          role: user.role || "user",
          is_superadmin: user.role === "superadmin",
          account_status: user.status,
          permissions: user.permissions || {},
          ip_limit: user.ip_limit ?? 2,
          ip_count: (user.allowed_ips || []).length,
          catalog: PAGES,
          always_allowed_routes: require("../helpers/rbac").ALWAYS_ALLOWED_ROUTES,
          shared_routes: require("../helpers/rbac").SHARED_ROUTES,
        },
      });
    } catch (error) {
      console.log("getMe error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
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
      const { password: _omit, login_otp: _otp, ...safeAdminData } = adminData.toObject();
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
