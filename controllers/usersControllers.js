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
const { getClientIp, CATALOG } = require("../helpers/rbac");
const { deviceIdOf, findDevice, newDevice } = require("../helpers/devices");
const { canSendCodes, sendLoginCode, sendSignupAlert } = require("../helpers/accountEmails");
const { sendInviteAccepted } = require("../helpers/portalEmails");
const { appUrl } = require("../helpers/mailer");
const teamAccess = require("../helpers/teamAccess");

const { OTP_TTL_MS, OTP_MAX_ATTEMPTS, AUDIT_KEEP, newCode, hashOtp, sealCode } = require("../helpers/signInCodes");
// Same rule as the email field in model/usersSchema.js.
const SIGNUP_EMAIL_RE =
  /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

// One-time sign-in codes, sent by email (helpers/accountEmails.js).
// On when LOGIN_OTP_ENABLED=true and email can be delivered (in production
// that needs EMAIL_USER/EMAIL_PASS), so a missing mailbox never locks anyone
// out.
//   LOGIN_OTP_MODE=every_login (default) every sign-in, the superadmin's included
//   LOGIN_OTP_MODE=new_device  only when signing in from a new IP
const loginOtpEnabled = () => process.env.LOGIN_OTP_ENABLED === "true" && canSendCodes();
const codeOnEveryLogin = () => (process.env.LOGIN_OTP_MODE || "every_login") === "every_login";


const findSuperadmin = () => UsersCollection.findOne({ role: "superadmin" }).lean();

// Emails the user who invited this contact person to the customer portal
// (or the organisation's owner) that the invitation was accepted.
const notifyInviteAccepted = async (person, contact) => {
  const org = contact ? await OrgCollection.findOne({ organization_id: contact.organization_id }).lean() : null;
  let inviter = null;
  if (person.invited_by && mongoose.isValidObjectId(person.invited_by)) {
    inviter = await UsersCollection.findById(person.invited_by).select("email").lean();
  }
  if (!inviter && org?.admin_id) inviter = await UsersCollection.findById(org.admin_id).select("email").lean();
  if (!inviter?.email) return;
  await sendInviteAccepted({
    to: inviter.email,
    personName: [person.first_name, person.last_name].filter(Boolean).join(" ") || person.email,
    personEmail: person.email,
    customerName: contact?.contact_name || contact?.company_name || "Your customer",
    orgName: org?.org_name || "your organisation",
    contactUrl: appUrl(`/sales/customer/${contact?.contact_id || ""}`),
  });
};

// Emails the superadmin that someone is waiting for approval.
const notifySuperadminOfSignup = async (newUser) => {
  const admin = await findSuperadmin();
  const to = admin?.email || process.env.SUPERADMIN_EMAIL;
  if (!to) return;
  const r = await sendSignupAlert(to, newUser);
  if (!r.ok) console.error("[sign-up alert] not sent:", r.error);
};

// Issues the session token once every check has passed.
const completeLogin = async (req, res, user) => {
  const ip = getClientIp(req);
  const now = new Date();
  const entry = findDevice(user, req);
  if (entry) {
    entry.last_login_at = now;
    entry.ip = ip; // where it was last seen
    if (!entry.device_id && deviceIdOf(req)) entry.device_id = deviceIdOf(req);
  }
  user.last_login_at = now;
  // A targeted update, not user.save(): two sign-ins (or a sign-in and a
  // password change) at the same moment must not fail with a version error.
  const update = { $set: { allowed_ips: user.allowed_ips, last_login_at: now }, $unset: { login_otp: 1 } };
  if (user.login_otp?.source === "admin") {
    update.$push = { sign_in_code_log: { $each: [{ action: "used", at: now, by_email: user.email }], $slice: -AUDIT_KEEP } };
  }
  await UsersCollection.updateOne({ _id: user._id }, update);

  // iat_ms: the issue time to the millisecond, so a removal from a team can end
  // the sessions issued before it (middleware/userMiddleware.js).
  const token = jwt.sign({ userId: user._id, role: "admin", iat_ms: Date.now() }, process.env.JWT_SECRET, {
    expiresIn: "10d",
  });
  // A team member signs in to the organisation they belong to.
  const membership = await teamAccess.membershipOf(user._id);
  const orgData = membership
    ? await OrgCollection.findOne({ organization_id: membership.organization_id }).lean()
    : (await OrgCollection.findOne({ admin_id: user._id, org_type: "default" }).lean()) ||
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

// A code the superadmin issued from Users & Access (see adminController).
// It replaces the emailed code for this sign-in, so it works when mail is down.
const pendingAdminCode = (user) => {
  const pending = user?.login_otp;
  if (pending?.source !== "admin" || !pending.code_hash) return null;
  return new Date(pending.expires_at) > new Date() && pending.attempts < OTP_MAX_ATTEMPTS ? pending : null;
};

const startAdminCodeStep = async (req, res, user, ip) => {
  // Bound to the device starting this sign-in, the same as an emailed code.
  await UsersCollection.updateOne({ _id: user._id }, { $set: { "login_otp.ip": ip } });
  const otpSession = jwt.sign({ userId: user._id, ip, purpose: "login-otp" }, process.env.JWT_SECRET, {
    expiresIn: "5m",
  });
  const expires = new Date(user.login_otp.expires_at);
  return res.status(ST_CODES.OK).json({
    otp_required: true,
    otp_session: otpSession,
    channel: "admin",
    sent_to: "",
    expires_at: expires,
    message: `Enter the sign-in code your administrator gave you. It expires at ${expires.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`,
  });
};

const startLoginOtp = async (req, res, user, ip) => {
  const code = newCode();
  user.login_otp = {
    code_hash: hashOtp(code),
    ip,
    expires_at: new Date(Date.now() + OTP_TTL_MS),
    attempts: 0,
  };
  await user.save();

  const sent = await sendLoginCode(user, code);
  if (!sent.ok) {
    // The email didn't go out. The code isn't lost: it's kept (encrypted, for
    // its 5 minutes) so the superadmin can read it under Users & Access and
    // pass it on, and the person can still finish signing in with it.
    const now = new Date();
    const isSuperadmin = user.role === "superadmin";
    await UsersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          login_otp: {
            code_hash: hashOtp(code),
            ip,
            expires_at: new Date(now.getTime() + OTP_TTL_MS),
            attempts: 0,
            source: "admin",
            auto: true,
            reason: "email_failed",
            issued_at: now,
            // The superadmin can't read their own code in the list they can't
            // reach: theirs goes to the server log (visible to whoever runs it).
            ...(isSuperadmin ? {} : { sealed: sealCode(code) }),
          },
        },
        $push: {
          sign_in_code_log: {
            $each: [{ action: "email_failed", at: now, by_email: "system", detail: String(sent.error || "").slice(0, 200) }],
            $slice: -AUDIT_KEEP,
          },
        },
      }
    );
    console.warn(`[sign-in code] couldn't email the code to ${user.email}: ${sent.error || "unknown error"}`);
    if (isSuperadmin) {
      console.warn(`[sign-in code] superadmin code for ${user.email}: ${code} (valid 5 minutes, needs the password too)`);
    }
    const otpSession = jwt.sign({ userId: user._id, ip, purpose: "login-otp" }, process.env.JWT_SECRET, { expiresIn: "5m" });
    return res.status(ST_CODES.OK).json({
      otp_required: true,
      otp_session: otpSession,
      channel: "admin",
      sent_to: "",
      expires_at: new Date(now.getTime() + OTP_TTL_MS),
      fallback: true,
      message: isSuperadmin
        ? "We couldn't email your code. It was written to the server log. Enter it here."
        : "We couldn't email your code. Ask your administrator for a temporary sign-in code and enter it here.",
    });
  }

  const otpSession = jwt.sign(
    { userId: user._id, ip, purpose: "login-otp" },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
  return res.status(ST_CODES.OK).json({
    otp_required: true,
    otp_session: otpSession,
    channel: sent.channel,
    sent_to: sent.sentTo,
    message: `Enter the 6-digit code we sent to ${sent.sentTo}.`,
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

      const company = String(companyName ?? "").trim();
      if (!company || !email || !password || !phoneNumber) {
        return res.status(400).json({ message: "Company name, email, password and mobile number are required" });
      }
      if (company.length > 120) {
        return res.status(400).json({ message: "Company name can be at most 120 characters" });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      if (normalizedEmail.length > 254 || !SIGNUP_EMAIL_RE.test(normalizedEmail)) {
        return res.status(400).json({ message: "Please enter a valid email address" });
      }
      let mobile = String(phoneNumber).replace(/\D/g, "");
      if (mobile.length === 12 && mobile.startsWith("91")) mobile = mobile.slice(2);
      if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });
      }

      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?=.{8,})/;
      if (!passwordRegex.test(String(password))) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character.",
        });
      }
      if (agreeToTerms !== true && agreeToTerms !== "true") {
        return res.status(400).json({ message: "Please accept the terms and conditions to continue" });
      }

      const existingUser = await UsersCollection.findOne({ email: normalizedEmail });
      if (existingUser)
        return res.status(400).json({ message: "User already exists" });
      if (await UsersCollection.exists({ mobile })) {
        return res.status(400).json({ message: "This mobile number is already registered" });
      }

      const hashedPassword = await bcrypt.hash(String(password), 10);

      // New accounts wait for superadmin approval and get no pages until the
      // superadmin grants them. The sign-up IP becomes their first allowed IP.
      const signupIp = getClientIp(req);
      const newUser = new UsersCollection({
        company_name: company,
        email: normalizedEmail,
        password: hashedPassword,
        mobile,
        country,
        state,
        agreement_status: true,
        role: "user",
        status: "pending",
        permissions: {},
        allowed_ips: signupIp
          ? [newDevice(req)]
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
      // Two sign-ups racing for the same email (double click): the unique
      // index refuses the second one.
      if (error?.code === 11000) {
        return res.status(400).json({ message: "User already exists" });
      }
      if (error?.name === "ValidationError") {
        const first = Object.values(error.errors || {})[0];
        return res.status(400).json({ message: first?.path === "email" ? "Please enter a valid email address" : first?.message || "Please check the form" });
      }
      console.log("reg error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
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
      let user = null;
      if (login.includes("@")) {
        user = await UsersCollection.findOne({ email: login });
        if (user && !(await bcrypt.compare(String(password), user.password))) user = null;
      } else {
        // Older accounts may share a mobile number: sign in to the one whose
        // password matches.
        const candidates = await UsersCollection.find({ mobile: login.replace(/\D/g, "") }).limit(20);
        for (const c of candidates) {
          if (await bcrypt.compare(String(password), c.password)) {
            user = c;
            break;
          }
        }
      }
      if (!user)
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
        // Team members who haven't accepted their invite, or were disabled.
        const teamBlock = await teamAccess.loginBlockFor(user._id);
        if (teamBlock) {
          return res.status(teamBlock.status).json({ code: teamBlock.code, message: teamBlock.message });
        }

      }

      const ip = getClientIp(req);
      const isSuperadmin = user.role === "superadmin";
      const known = isSuperadmin || Boolean(findDevice(user, req));
      if (!known && (user.allowed_ips || []).length >= (user.ip_limit ?? 2)) {
        await UsersCollection.updateOne(
          { _id: user._id },
          { $set: { last_blocked_ip: { ip, at: new Date(), user_agent: String(req.headers["user-agent"] || "").slice(0, 200) } } }
        );
        return res.status(ST_CODES.FORBIDDEN).json({
          code: "IP_LIMIT_REACHED",
          ip,
          message: `You can only sign in from ${user.ip_limit ?? 2} devices/networks, and this one (${ip}) isn't one of them. Ask your administrator to remove an old one.`,
        });
      }
      if (user.login_otp?.source === "admin") {
        if (pendingAdminCode(user)) return startAdminCodeStep(req, res, user, ip);
        await UsersCollection.updateOne({ _id: user._id }, { $unset: { login_otp: 1 } });
      }
      if (loginOtpEnabled() && (codeOnEveryLogin() || !known)) {
        return startLoginOtp(req, res, user, ip);
      }
      if (!known) {
        user.allowed_ips.push(newDevice(req));
      }

      return completeLogin(req, res, user);
    } catch (error) {
      console.log("login error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
  }
  // Second login step: checks the code, then remembers the IP.
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
      // The code proves who is signing in. It is not tied to the address the
      // password step came from: the two requests can arrive from different
      // addresses (IPv4/IPv6, a proxy, a mobile network), which used to leave
      // people unable to finish. The device remembered is the one that entered
      // the code, and the device limit is checked against it below.
      if (session.purpose !== "login-otp") {
        return res.status(ST_CODES.BAD_REQUEST).json({
          code: "OTP_INVALID",
          message: "Please sign in again.",
        });
      }

      const user = await UsersCollection.findById(session.userId);
      const pending = user?.login_otp;
      const isSuperadmin = user?.role === "superadmin";
      if (!user || (!isSuperadmin && user.status !== "active") || !pending?.code_hash) {
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
      if (!isSuperadmin && !findDevice(user, req)) {
        const limit = user.ip_limit ?? 2;
        if ((user.allowed_ips || []).length >= limit) {
          await UsersCollection.updateOne(
            { _id: user._id },
            { $set: { last_blocked_ip: { ip, at: new Date(), user_agent: String(req.headers["user-agent"] || "").slice(0, 200) } } }
          );
          return res.status(ST_CODES.FORBIDDEN).json({
            code: "IP_LIMIT_REACHED",
            ip,
            message: `You've hit the device limit: this account can sign in from ${limit} device${limit === 1 ? "" : "s"}/network${limit === 1 ? "" : "s"}, and this one (${ip}) isn't one of them. Ask your administrator to remove an old one.`,
          });
        }
        user.allowed_ips.push(newDevice(req));
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
      // A team member's access is what their role gives within the
      // organisation (res.user, from the middleware); their own account is
      // still their login.
      const member = res.locals.member;
      const user = await UsersCollection.findById(res.locals.actor_id || res.locals.user_id)
        .select("email mobile company_name role status permissions limits ip_limit allowed_ips")
        .lean();
      if (!user) return res.status(ST_CODES.NOT_FOUND).json({ message: "User not found" });
      const access = member ? res.user : user;
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          // The signed-in person (not the organisation admin), used to scope per-user UI state.
          id: String(user._id),
          email: user.email,
          mobile: user.mobile,
          company_name: user.company_name,
          role: user.role || "user",
          is_superadmin: user.role === "superadmin",
          account_status: user.status,
          permissions: access.permissions || {},
          ip_limit: user.ip_limit ?? 2,
          ip_count: (user.allowed_ips || []).length,
          limits: access.limits || {},
          usage: (await require("../helpers/usageLimits").usageFor([access._id]))[String(access._id)],
          // Set when this person is on a team (the organisation they belong to).
          team: member ? { organisation_id: member.organization_id, org_name: member.org_name, role_id: member.role_id, role_name: member.role_name } : null,
          catalog: CATALOG,
          always_allowed_routes: require("../helpers/rbac").ALWAYS_ALLOWED_ROUTES,
          shared_routes: require("../helpers/rbac").SHARED_ROUTES,
          // Modules without screens yet: nobody is linked to them.
          planned_routes: require("../helpers/rbac").PAGES.filter((p) => p.planned).flatMap((p) => p.routes),
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
      // A team member sees the organisation admin's name and contact only,
      // not the admin's sign-in devices, limits or permissions.
      const data = res.locals.member
        ? { _id: safeAdminData._id, email: safeAdminData.email, company_name: safeAdminData.company_name, country: safeAdminData.country, state: safeAdminData.state, role: safeAdminData.role, status: safeAdminData.status }
        : safeAdminData;
      return res.status(ST_CODES.OK).send({
        status: true,
        data,
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

      const user = await ClientCollection.findOne({ email: String(email), role: String(role) });
      if (!user)
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Invalid credentials" });

      const isMatch = await bcrypt.compare(String(password), user.password);
      if (!isMatch)
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Invalid credentials" });

      // The portal is only open while the business that owns this customer
      // is active and has Customer Portal switched on by the superadmin.
      const owningContact = await ContactCollection.findOne({ contact_id: user.client_id }, { admin_id: 1 }).lean();
      const owner = owningContact && (await UsersCollection.findById(owningContact.admin_id).lean());
      const portalOn =
        owner &&
        (owner.role === "superadmin" ||
          (owner.status === "active" && (owner.permissions?.customerPortal || []).includes("view")));
      if (!portalOn) {
        return res.status(ST_CODES.FORBIDDEN).json({
          code: "PORTAL_DISABLED",
          message: "The customer portal isn't available for this business.",
        });
      }

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
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
  }

  // POST /client/register  { token, password }
  // A customer accepts a portal invitation: the token from the invitation
  // email says who they are, and they choose a password. The user who sent
  // the invitation is told by email (and sees it in their notifications).
  async clientRegister(req, res) {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: "Open the link from your invitation email to set your password." });
      }
      let invite;
      try {
        invite = jwt.verify(String(token), process.env.JWT_SECRET || "portal-invite-secret-key");
      } catch {
        return res.status(400).json({ message: "This invitation link has expired or isn't valid. Ask for a new invitation." });
      }
      // Older invitations have no purpose claim but always carry these two.
      if ((invite.purpose && invite.purpose !== "portal_invite") || !invite.clientPersonId || !invite.email) {
        return res.status(400).json({ message: "This invitation link isn't valid. Ask for a new invitation." });
      }
      const email = String(invite.email).trim().toLowerCase();
      const role = "client";

      const existingUser = await ClientCollection.findOne({ email, role });
      if (existingUser)
        return res.status(400).json({
          message:
            "The Customer Portal has already been enabled for this email address. Try signing in to the portal instead, or sign up using a different email address.",
        });
      const contact = await ContactPersonCollection.findOne({
        contact_person_id: String(invite.clientPersonId),
      });
      if (!contact || !contact.is_added_in_portal || String(contact.email || "").trim().toLowerCase() !== email) {
        return res.status(404).json({ message: "This invitation is no longer valid. Ask for a new invitation." });
      }
      const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?=.{8,})/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters long and include at least one uppercase letter, one number, and one special character.",
        });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = new ClientCollection({
        email,
        password: hashedPassword,
        client_id: contact.contact_id,
        client_person_id: contact.contact_person_id,
        role,
        status: "active",
        role_formatted: "Client",
      });
      await newUser.save();
      const acceptedAt = new Date();
      await ContactPersonCollection.updateOne(
        { contact_person_id: contact.contact_person_id },
        { $set: { is_portal_invitation_accepted: true, portal_accepted_at: acceptedAt } }
      );
      const contactData = await ContactCollection.findOne({ contact_id: newUser.client_id }).lean();
      if (contactData) {
        await ContactCollection.updateOne(
          { contact_id: contactData.contact_id, organization_id: contactData.organization_id },
          { $set: { portal_status: "active", portal_status_formatted: "Active" } }
        );
      }
      const sessionToken = jwt.sign({ userId: newUser._id, role: "client" }, process.env.JWT_SECRET, {
        expiresIn: "10d",
      });

      // Tell whoever sent the invitation (else the organisation's owner).
      // The customer is signed in either way, so this never fails the request.
      notifyInviteAccepted(contact, contactData).catch((err) =>
        console.error("invite-accepted notice failed:", err.message)
      );

      const { password: _omit, ...safeNewUser } = newUser.toObject();
      res.status(ST_CODES.OK).json({
        message: "User registered successfully",
        status: true,
        token: sessionToken,
        org_id: contactData?.organization_id,
        data: safeNewUser,
      });
    } catch (error) {
      console.log("reg error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
  }

  // async checkEmailVaild(req,res){

  // }
}

module.exports = new usersController();
