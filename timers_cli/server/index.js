const bodyParser = require("body-parser");
const express = require("express");
const { nanoid } = require("nanoid");
const crypto = require("crypto");
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

app.use(express.json());
app.use(express.static("public"));

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
  const { sessionId } = req.params;
  if (!sessionId) {
    return next();
  }
  const user = await findUserBySessionId(req.db, sessionId);
  req.user = user;
  req.sessionId = sessionId;

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
    const user = await findUserBySessionId(req.db, req?.headers?.sessionid);
    if (!user) {
      return res.status(500).json({ msg: 'Error in getting user from session Id'})
    }

    const db = req.db;

    let userTimers = await db.collection("timers").find({ userId: user?._id }).toArray();

    if (!userTimers) {
      userTimers = [];
    }
    const result = userTimers
      .map((timer) => {
        console.log('timer', timer)
        if (timer.isActive && timer.isActive === true) {
          return {
            ...timer,
            progress: Date.now() - timer.start,
          };
        }
        if (!timer.isActive && timer.isActive === false) {
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
    const user = await findUserBySessionId(req.db, req?.headers?.sessionid);

    const { taskName } = req.body;

    const timer = getNewTimer(taskName, user);

    const { insertedId } = await req.db.collection("timers").insertOne(timer);

    res.status(201).json({ taskName, id: insertedId });
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

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await findUserByUsername(req.db, username);

    console.log("user", !user || user?.password !== hash(password));

    if (!user || user?.password !== hash(password)) {
      return res.status(400).json({ msg: "Wrong username or password!" });
    }

    const sessionId = await createSession(req.db, user.username);

    res.json({ sessionId });
  } catch (error) {
    console.error(error);
    res.status(400).json({ msg: error || "Wrong username or password!" });
  }
});

app.get("/logout", auth(), async (req, res) => {
  try {
    if (!req.user) {
      res.json({ res: "no user" });
    }
    deleteSession(req.db, req?.headers?.sessionid );
    res.json({ res: "success" });
  } catch (error) {
    console.error(error);
    res.json({ error: error });
  }
});

app.post("/signup", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await findUserByUsername(req.db, username);

    if (user) {
      return res.status(400).json({ msg: "User exists" });
    }

    const hashedPassword = typeof password === "string" ? hash(password) : null;
    if (!hashedPassword) {
      console.error("error with hash");
      return res.status(406);
    }

    await req.db.collection("users").insertOne({
      username,
      password: hashedPassword,
    });

    const sessionId = await createSession(req.db, username);

    return res.json({ sessionId: sessionId });
  } catch (error) {
    console.error(error);
    res.status(400);
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
