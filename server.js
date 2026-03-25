const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");

const express = require("express");
const { Server } = require("socket.io");

const { createDatabase } = require("./lib/database");
const { loadEnv } = require("./lib/load-env");

loadEnv(path.join(__dirname, ".env"));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, "public");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || 3000;
const cookieName = "signal_admin";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;

const defaultAdminPassword = "change-me-now";
const defaultSessionSecret = "local-dev-session-secret";

const adminPassword = process.env.ADMIN_PASSWORD || defaultAdminPassword;
const sessionSecret = process.env.SESSION_SECRET || defaultSessionSecret;

const sqlitePath = resolveDatabasePath(process.env.SQLITE_PATH || "data/signal.sqlite");
const database = createDatabase(sqlitePath);

const signalState = {
  activeParticipants: 0,
  peakParticipants: 0,
  totalJoins: 0,
  lastJoinAt: null,
};

const allowedProjectTypes = new Set([
  "Product launch",
  "Live event",
  "Community activation",
  "Internal campaign",
]);

const allowedTimelines = new Set([
  "ASAP",
  "2-4 weeks",
  "1-2 months",
  "Flexible",
]);

const allowedBudgetRanges = new Set([
  "Under $2k",
  "$2k-$5k",
  "$5k-$15k",
  "$15k+",
  "Not sure yet",
]);

const allowedStatuses = new Set(["new", "reviewing", "contacted", "closed"]);

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use(express.json({ limit: "300kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(publicDir, { index: false }));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/admin", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(publicDir, "admin", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    ...getSiteSnapshot(),
  });
});

app.get("/api/site", (req, res) => {
  res.json(getSiteSnapshot());
});

app.post("/api/submissions", (req, res) => {
  try {
    const submission = validateSubmission(req.body);
    database.createSubmission(submission, getRequestMetadata(req));

    const snapshot = getSiteSnapshot();
    io.emit("site", snapshot);

    res.status(201).json({
      ok: true,
      message: "Thanks. Your launch brief is in the control room now.",
      snapshot,
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

app.get("/api/admin/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    authenticated: isAuthenticated(req),
  });
});

app.post("/api/admin/login", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const password = sanitizeText(req.body.password, 120);
  if (!password) {
    res.status(400).json({
      ok: false,
      error: "Enter the admin password.",
    });
    return;
  }

  if (!constantTimeTextEqual(password, adminPassword)) {
    res.status(401).json({
      ok: false,
      error: "That password is not correct.",
    });
    return;
  }

  setSessionCookie(res, createAdminSessionToken());
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/overview", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    overview: database.getAdminOverview(getLiveSignalState(), getSecurityFlags()),
  });
});

app.get("/api/admin/submissions", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    submissions: database.listSubmissions(100),
  });
});

app.patch("/api/admin/submissions/:id", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const submissionId = Number(req.params.id);
  const status = sanitizeText(req.body.status, 32).toLowerCase();
  const adminNotes = sanitizeText(req.body.adminNotes, 1200);

  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    res.status(400).json({
      ok: false,
      error: "Invalid submission id.",
    });
    return;
  }

  if (!allowedStatuses.has(status)) {
    res.status(400).json({
      ok: false,
      error: "Choose a valid submission status.",
    });
    return;
  }

  const updatedSubmission = database.updateSubmission(submissionId, {
    status,
    adminNotes,
  });

  if (!updatedSubmission) {
    res.status(404).json({
      ok: false,
      error: "Submission not found.",
    });
    return;
  }

  res.json({
    ok: true,
    submission: updatedSubmission,
  });
});

io.on("connection", (socket) => {
  socket.data.joined = false;
  socket.emit("state", getLiveSignalState());
  socket.emit("site", database.getPublicMetrics());

  socket.on("joinSignal", () => {
    if (socket.data.joined) {
      socket.emit("state", getLiveSignalState());
      return;
    }

    socket.data.joined = true;
    signalState.activeParticipants += 1;
    signalState.totalJoins += 1;
    signalState.peakParticipants = Math.max(
      signalState.peakParticipants,
      signalState.activeParticipants,
    );
    signalState.lastJoinAt = new Date().toISOString();

    io.emit("pulse", {
      activeParticipants: signalState.activeParticipants,
      joinedAt: signalState.lastJoinAt,
    });
    io.emit("state", getLiveSignalState());
  });

  socket.on("disconnect", () => {
    if (!socket.data.joined) {
      return;
    }

    socket.data.joined = false;
    signalState.activeParticipants = Math.max(
      0,
      signalState.activeParticipants - 1,
    );
    io.emit("state", getLiveSignalState());
  });
});

server.listen(port, () => {
  if (getSecurityFlags().usingDefaultAdminPassword) {
    console.warn(
      "ADMIN_PASSWORD is using the local default. Set a real value before deploying.",
    );
  }

  if (getSecurityFlags().usingDefaultSessionSecret) {
    console.warn(
      "SESSION_SECRET is using the local default. Set a long random secret before deploying.",
    );
  }

  console.log(`Signal server running on http://localhost:${port}`);
});

function resolveDatabasePath(configuredPath) {
  if (configuredPath === ":memory:") {
    return configuredPath;
  }

  return path.resolve(__dirname, configuredPath);
}

function getLiveSignalState() {
  return { ...signalState };
}

function getSiteSnapshot() {
  return {
    ...getLiveSignalState(),
    ...database.getPublicMetrics(),
  };
}

function getSecurityFlags() {
  return {
    usingDefaultAdminPassword: adminPassword === defaultAdminPassword,
    usingDefaultSessionSecret: sessionSecret === defaultSessionSecret,
  };
}

function getRequestMetadata(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ipAddress = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || req.socket.remoteAddress || "")
        .split(",")[0]
        .trim();

  return {
    ipAddress: sanitizeText(ipAddress, 120),
    userAgent: sanitizeText(req.headers["user-agent"], 300),
  };
}

function sanitizeText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function validateSubmission(body) {
  const name = sanitizeText(body.name, 80);
  const email = sanitizeText(body.email, 160).toLowerCase();
  const company = sanitizeText(body.company, 120);
  const projectType = sanitizeText(body.projectType, 80);
  const timeline = sanitizeText(body.timeline, 60);
  const budgetRange = sanitizeText(body.budgetRange, 60);
  const message = sanitizeText(body.message, 2000);
  const wantsDemo =
    body.wantsDemo === true ||
    body.wantsDemo === "true" ||
    body.wantsDemo === "on";

  if (name.length < 2) {
    throw createRouteError(400, "Add your name.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createRouteError(400, "Add a valid email address.");
  }

  if (!allowedProjectTypes.has(projectType)) {
    throw createRouteError(400, "Choose the project type.");
  }

  if (!allowedTimelines.has(timeline)) {
    throw createRouteError(400, "Choose the timeline.");
  }

  if (!allowedBudgetRanges.has(budgetRange)) {
    throw createRouteError(400, "Choose the budget range.");
  }

  if (message.length < 12) {
    throw createRouteError(400, "Tell us a bit more about the launch.");
  }

  return {
    name,
    email,
    company,
    projectType,
    timeline,
    budgetRange,
    message,
    wantsDemo,
  };
}

function createRouteError(status, message) {
  return { status, message };
}

function handleRouteError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const message =
    status >= 500 ? "Something went wrong on the server." : error.message;

  res.status(status).json({
    ok: false,
    error: message,
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, part) => {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rest.join("=") || "");
    return cookies;
  }, {});
}

function signValue(value) {
  return crypto
    .createHmac("sha256", sessionSecret)
    .update(value)
    .digest("base64url");
}

function constantTimeTextEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function createAdminSessionToken() {
  const expiresAt = Date.now() + sessionTtlMs;
  const payload = `admin:${expiresAt}`;
  return `${payload}.${signValue(payload)}`;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const sessionValue = cookies[cookieName];

  if (!sessionValue) {
    return false;
  }

  const lastDot = sessionValue.lastIndexOf(".");
  if (lastDot <= 0) {
    return false;
  }

  const payload = sessionValue.slice(0, lastDot);
  const signature = sessionValue.slice(lastDot + 1);

  if (!constantTimeTextEqual(signature, signValue(payload))) {
    return false;
  }

  const [role, expiresAtRaw] = payload.split(":");
  const expiresAt = Number(expiresAtRaw);

  return role === "admin" && Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function setSessionCookie(res, value) {
  const parts = [
    `${cookieName}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
  ];

  if (isProduction) {
    parts.push("Secure");
  }

  res.append("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const parts = [
    `${cookieName}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (isProduction) {
    parts.push("Secure");
  }

  res.append("Set-Cookie", parts.join("; "));
}

function requireAdmin(req, res, next) {
  if (!isAuthenticated(req)) {
    res.status(401).json({
      ok: false,
      error: "Admin login required.",
    });
    return;
  }

  next();
}
