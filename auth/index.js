const bodyParser = require("body-parser");
const express = require("express");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const knex = require("knex");
const knexConfig = require("./knexfile");

const dbConnection = knex(knexConfig);

// const checkKnex = () => {
//   dbConnection.schema.hasTable("timers").then(
//     function (exists) {
//       console.log("exists", exists);
//     },
//     function (err) {
//       console.log("[db] Could not check subroutine table: " + err.stack);
//     }
//   );
// };

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

const getNewTimer = (description, user) => {
  return {
    start: Date.now(),
    description,
    isActive: true,
    userId: user.id,
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

    const userTimers = await dbConnection("timers").select().where("userId", user.id);

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
    const user = await findUserBySessionId(req.cookies["sessionId"]);

    const { description } = req.body;

    const timer = getNewTimer(description, user);

    const idsArray = await dbConnection("timers").insert(timer).returning("id");

    res.status(201).json({ description, id: idsArray[0].id });
  } catch (error) {
    console.log("error ====>", error);
    res.sendStatus(400);
  }
});

app.post("/api/timers/:id/stop", auth(), async (req, res) => {
  try {
    const id = req.params.id;

    const deletedTimers = await dbConnection("timers").select().where("id", id);

    if (!deletedTimers.length) {
      return res.sendStatus(404);
    }
    const deletedTimer = deletedTimers[0];
    const end = Date.now();
    const newTimerData = {
      end,
      isActive: false,
      duration: end - deletedTimer.start,
    };

    await dbConnection("timers").update(newTimerData).where("id", deletedTimer.id);

    res.status(201).json({ id });
  } catch {
    res.sendStatus(500);
  }
});

// auth

const createSession = async (userName) => {
  const sessionId = nanoid();
  await dbConnection("sessions").insert({
    sessionId,
    username: userName,
  });
  return sessionId;
};

const deleteSession = async (sessionId) => {
  return dbConnection("sessions").where("sessionId", sessionId).delete();
};

const findUserBySessionId = async (sessionId) => {
  const usernames = await dbConnection("sessions").select("username").where("sessionId", sessionId).limit(1);

  if (!usernames.length) {
    return null;
  }
  const users = await dbConnection("users").select().where("username", usernames[0].username);

  if (!users.length) {
    return null;
  }

  return users[0];
};

const findUserByUsername = async (username) => {
  const users = await dbConnection("users").select().where("username", username);
  if (!users.length) {
    return;
  }
  return users[0];
};

app.post("/login", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await findUserByUsername(username);

    if (!user || user?.password !== hash(password)) {
      return res.redirect("/?authError=true");
    }
    const sessionId = await createSession(user.username);

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

    await dbConnection("users").insert({
      username,
      password: hash(password),
    });

    const sessionId = await createSession(username);
    res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
  } catch {
    res.status(400);
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
