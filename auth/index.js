const bodyParser = require("body-parser");
const express = require("express");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");

const app = express();

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

let TIMERS = [
  {
    start: Date.now(),
    description: "Timer 1",
    isActive: true,
    id: nanoid(),
    userId: "1",
  },
  {
    start: Date.now() - 5000,
    end: Date.now() - 3000,
    duration: 2000,
    description: "Timer 0",
    isActive: false,
    id: nanoid(),
    userId: "1",
  },
];

let DB = {
  users: [
    {
      _id: "1",
      username: "admin",
      password: hash("admin"),
    },
  ],
  sessions: {},
  timers: TIMERS,
};

const getNewTimer = (description, user) => {
  return {
    start: Date.now(),
    description,
    isActive: true,
    id: nanoid(),
    userId: user._id,
  };
};

const auth = () => async (req, res, next) => {
  if (!req.cookies?.["sessionId"]) {
    return next();
  }
  const user = await findUserBySessionId(req.cookies["sessionId"]);
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
    const user = await findUserBySessionId(req.cookies["sessionId"]);

    const { isActive } = req.query;
    const result = TIMERS.filter((timer) => timer.userId === user._id)
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
  } catch {
    res.sendStatus(500);
  }
});

app.post("/api/timers", auth(), async (req, res) => {
  try {
    const user = await findUserBySessionId(req.cookies["sessionId"]);

    const { description } = req.body;

    const timer = getNewTimer(description, user);
    TIMERS.push(timer);

    res.status(201).json({ description, id: timer.id });
  } catch {
    res.sendStatus(400);
  }
});

app.post("/api/timers/:id/stop", auth(), (req, res) => {
  try {
    const id = req.params.id;
    const deletedTimer = TIMERS.find((timer) => timer.id === id);
    deletedTimer.end = Date.now();
    deletedTimer.isActive = false;
    deletedTimer.duration = deletedTimer.end - deletedTimer.start;
    res.status(201).json({ id });
  } catch {
    res.sendStatus(500);
  }
});

// auth

const createSession = async (userId) => {
  const sessionId = nanoid();
  DB.sessions[sessionId] = userId;
  return sessionId;
};
const deleteSession = async (sessionId) => {
  delete DB.sessions[sessionId];
};

const findUserBySessionId = async (sessionId) => {
  const userId = DB.sessions[sessionId];
  if (!userId) {
    return;
  }
  return DB.users.find((user) => user._id === userId);
};

const findUserByUsername = async (username) => DB.users.find((user) => user.username === username);

app.post("/login", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await findUserByUsername(username);
    if (!user || user?.password !== hash(password)) {
      return res.redirect("/?authError=true");
    }
    const sessionId = await createSession(user._id);
    res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
  } catch {
    res.status(400);
  }
});

app.get("/logout", auth(), async (req, res) => {
  if (!req.user) {
    return res.redirect("/");
  }
  await deleteSession(req.sessionId);
  res.clearCookie("sessionId").redirect("/");
});

app.post("/signup", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await findUserByUsername(username);
    if (user) {
      return res.status(400).json({ msg: "User exists" });
    }
    const id = nanoid();
    DB.users.push({
      _id: id,
      username,
      password: hash(password),
    });
    const sessionId = await createSession(id);
    res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
  } catch {
    res.status(400);
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
