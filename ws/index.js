const bodyParser = require("body-parser");
const express = require("express");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const app = express();
const http = require("http");

const server = http.createServer(app);

const WebSocket = require("ws");
const clients = new Map();

const port = process.env.PORT || 3000;

const wss = new WebSocket.Server({
  clientTracking: false,
  noServer: true,
});

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

const MESSAGE_TYPES = {
  newTimer: "new_timer",
  stopTimer: "stop_timer",
};

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

const getNewTimer = (description, userId) => {
  return {
    start: Date.now(),
    description,
    isActive: true,
    userId,
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

const findSessionIdByUsername = async (db, userName) => {
  return await db.collection("sessions").findOne({ username: userName });
};

const findUserByUsername = async (db, username) => {
  const user = await db.collection("users").findOne({ username });
  return user;
};

const findUserByToken = async (db, token) => {
  const user = await db.collection("users").findOne({ _id: new ObjectId(token) });

  if (!user) {
    return;
  }
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

    const db = req.db;

    server.once("upgrade", async (req, socket, head) => {
      const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
      const token = searchParams && searchParams.get("token");
      const user = await findUserByToken(db, token);
      const sessionId = await findSessionIdByUsername(db, user.username);

      if (!user || !sessionId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      req.userId = user;

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    const sendTimers = async () => {
      for ([key, ws] of clients) {
        const user = await findUserByUsername(db, key);
        const timers = await getTimersFromDb({ userId: user._id });
        ws.send(JSON.stringify({ timers }));
      }
    };

    const removeTimers = async (id) => {
      const deletedTimer = await db.collection("timers").findOne({ _id: new ObjectId(id) });
      if (!deletedTimer) {
        return;
      }
      const now = Date.now();
      await db.collection("timers").findOneAndUpdate(
        { _id: new ObjectId(deletedTimer._id) },
        { $set: { duration: now - deletedTimer.start, isActive: false, end: now } },
        {
          returnOriginal: false,
        }
      );
    };

    wss.on("connection", (ws, req) => {
      const { userId } = req;

      if (userId) {
        clients.set(userId.username, ws);
      }

      const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          sendTimers();
        }
      }, 1000);

      ws.on("close", () => {
        if (userId) {
          clients.delete(userId.username);
        }
        clearInterval(interval);
      });

      ws.on("message", async (message) => {
        let data;
        try {
          data = JSON.parse(message);
        } catch (err) {
          console.log("error", err);
        }
        if (data.type === MESSAGE_TYPES.newTimer) {
          await insertNewTimerInDb(data);
          sendTimers();
        } else if (data.type === MESSAGE_TYPES.stopTimer) {
          removeTimers(data.id);
        }
      });
    });

    res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
  } catch (error) {
    console.error(error);
    res.status(400);
  }
});

const insertNewTimerInDb = async (message) => {
  const { type, userId, description } = message ?? {};
  if (type === MESSAGE_TYPES.newTimer) {
    const timer = getNewTimer(description, userId);
    const client = await clientPromise;
    const db = await client.db("timers");
    await db.collection("timers").insertOne(timer);
    console.log("Insert ", timer);
  }
};

const getTimersFromDb = async ({ userId }) => {
  const idString = userId.toHexString();
  const client = await clientPromise;
  const db = await client.db("timers");
  const query = { userId: idString };
  let userTimers = await db.collection("timers").find(query).toArray();
  if (!userTimers) {
    userTimers = [];
  }
  const result = userTimers
    .map((timer) => {
      const { _id, ...rest } = timer;

      if (timer.isActive) {
        return {
          ...rest,
          id: _id.toHexString(),
          progress: Date.now() - timer.start,
        };
      }
      if (!timer.isActive) {
        return {
          ...rest,
          id: _id.toHexString(),
          progress: timer.end - timer.start,
        };
      }
      return false;
    })
    .filter((timer) => !!timer);

  return result;
};

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

app.get("/", auth(), (req, res) => {
  res.render("index", {
    user: req.user,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

server.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
