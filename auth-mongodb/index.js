const bodyParser = require("body-parser");
const express = require("express");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const app = express();

const { MongoClient, ObjectId } = require("mongodb");

const clientPromise = MongoClient.connect(process.env.DB_URI, {
  maxPoolSize: 10,
  useUnifiedTopology: true,
});

app.use(async (req, res, next) => {
  try {
    const client = await clientPromise;
    const db = await client.db("timers");
    req.db = db;
    next();
  } catch (err) {
    next(err);
  }
});

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.set("view engine", "njk");

app.use(express.json());
app.use(express.static("public"));
app.use(cookieParser());

const hash = (str) => crypto.createHash("sha256").update(str).digest("hex");

const getNewTimer = (description, user) => {
  return {
    start: Date.now(),
    description,
    isActive: true,
    userId: user._id,
  };
};

const auth = () => async (req, res, next) => {
  if (!req.cookies?.["sessionId"]) {
    return next();
  }
  const user = await findUserBySessionId(req.db, req.cookies["sessionId"]);
  req.user = user;
  req.sessionId = req.cookies["sessionId"];

  next();
};

app.get("/", auth(), (req, res) => {
  res.render("index", {
    user: req.user,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

app.get("/api/timers", auth(), async (req, res) => {
  try {
    const user = await findUserBySessionId(req.db, req.cookies["sessionId"]);
    const { isActive } = req.query;
    const db = req.db;

    let userTimers = await db.collection("timers").find({ userId: user._id }).toArray();

    if (!userTimers) {
      userTimers = [];
    }
    const result = userTimers
      .map((timer) => {
        if (timer.isActive && isActive === "true") {
          return {
            ...timer,
            progress: Date.now() - timer.start,
          };
        }
        if (!timer.isActive && isActive === "false") {
          return {
            ...timer,
            progress: timer.end - timer.start,
          };
        }
        return false;
      })
      .filter((timer) => !!timer);
    res.json(result);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.post("/api/timers", auth(), async (req, res) => {
  try {
    const user = await findUserBySessionId(req.db, req.cookies["sessionId"]);

    const { description } = req.body;

    const timer = getNewTimer(description, user);

    const data = await req.db.collection("timers").insertOne(timer);

    res.status(201).json({ description, id: data._id });
  } catch (error) {
    console.error(error);
    res.sendStatus(400);
  }
});

app.post("/api/timers/:id/stop", auth(), async (req, res) => {
  try {
    const id = req.params.id;
    const db = req.db;

    const deletedTimer = await db.collection("timers").findOne({ _id: new ObjectId(id) });

    if (!deletedTimer) {
      return res.sendStatus(404);
    }

    const now = Date.now();

    await db.collection("timers").findOneAndUpdate(
      { _id: new ObjectId(deletedTimer._id) },
      { $set: { duration: now - deletedTimer.start, isActive: false, end: now } },
      {
        returnOriginal: false,
      }
    );

    res.status(201).json({ id });
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});

// auth

const createSession = async (db, userName) => {
  const sessionId = nanoid();
  await db.collection("sessions").insertOne({
    sessionId,
    username: userName,
  });
  return sessionId;
};

const deleteSession = async (db, sessionId) => {
  return db.collection("sessions").deleteOne({ sessionId });
};

const findUserBySessionId = async (db, sessionId) => {
  const session = await db.collection("sessions").findOne({ sessionId });
  if (!session) {
    return;
  }
  const username = session.username;
  const user = await db.collection("users").findOne({ username });
  return user;
};

const findUserByUsername = async (db, username) => {
  const user = await db.collection("users").findOne({ username });
  return user;
};

app.post("/login", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await findUserByUsername(req.db, username);

    if (!user || user?.password !== hash(password)) {
      return res.redirect("/?authError=true");
    }
    const sessionId = await createSession(req.db, user.username);

    res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
  } catch (error) {
    console.error(error);
    res.status(400);
  }
});

app.get("/logout", auth(), async (req, res) => {
  if (!req.user) {
    return res.redirect("/");
  }
  await deleteSession(req.db, req.sessionId);
  res.clearCookie("sessionId").redirect("/");
});

app.post("/signup", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await findUserByUsername(req.db, username);

    if (user) {
      return res.status(400).json({ msg: "User exists" });
    }

    await req.db.collection("users").insertOne({
      username,
      password: hash(password),
    });

    const sessionId = await createSession(req.db, username);
    res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
  } catch (error) {
    console.error(error);
    res.status(400);
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
