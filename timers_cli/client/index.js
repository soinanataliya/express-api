import os from "os";
import path from "path";
import inquirer from "inquirer";
import minimist from "minimist";
import fs from "fs";

const homeDir = os.homedir();
const isWindows = os.type().match(/windows/i);
const sessionFileName = path.join(homeDir, `${isWindows ? "_" : "."}sb-timers-session`);
console.log("File to keep the session ID:", sessionFileName);

const argv = minimist(process.argv.slice(2));

const functionName = argv["_"][0];
const functionParam = argv["_"][1];

const url = process.env.SERVER || "http://localhost:3000";

const writeFile = async (content) => {
  try {
    await fs.writeFile(sessionFileName, content, (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log("Successfully logged in");
      }
    });
  } catch (error) {
    console.error("Error in writing file", error);
    process.exit(100);
  }
};

const readFile = async () => {
  try {
    return await fs.readFileSync(sessionFileName, { encoding: "utf8" });
  } catch (error) {
    console.error("Error in reading file", error);
    process.exit(100);
  }
};

const signup = async () => {
  console.log("Signup");
  try {
    const answers = await inquirer.prompt([
      {
        name: "username",
        message: "Username",
      },
      {
        name: "password",
        message: "Password",
        type: "password",
      },
    ]);

    const { username, password } = answers;

    const response = await fetch(`${url}/signup`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const status = await response.status;
    if (status === 200) {
      const { sessionId } = (await response.json()) ?? {};
      await writeFile(sessionId);

      setTimeout(async () => {
        await readFile();
      }, 2000);
      return;
    }

    const { msg } = (await response.json()) ?? {};
    console.log("serverAnswer: ", msg);
  } catch (error) {
    console.log("Cannot signup");
  }
};

const login = async () => {
  console.log("Log in");
  try {
    const answers = await inquirer.prompt([
      {
        name: "username",
        message: "Username",
      },
      {
        name: "password",
        message: "Password",
        type: "password",
      },
    ]);

    const { username, password } = answers;

    const response = await fetch(`${url}/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const status = await response.status;
    const { sessionId } = (await response.json()) ?? {};
    if (status === 200 && sessionId) {
      await writeFile(sessionId);

      setTimeout(async () => {
        await readFile();
      }, 2000);
      return;
    }

    const answer = (await response.json()) ?? {};
    console.log("serverAnswer: ", answer);
  } catch (error) {
    console.error("Cannot signup");
  }
};

const logout = () => {
  try {
    fs.unlinkSync(sessionFileName);
    console.log("Logged out successfully!");
  } catch (error) {
    console.error("Cannot logout");
  }
};

const status = async (param) => {
  try {
    console.log("Timers list");

    const sessionId = await readFile();

    if (!sessionId) {
      console.error("You are not logged in");
      return;
    }

    const response = await fetch(`${url}/api/timers`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        sessionId,
      },
    });

    const listOfTimers = (await response.json()) ?? {};

    if (!param) {
      console.table(prepareTableView(listOfTimers));
      return;
    } else if (param === "old") {
      console.table(prepareTableView(listOfTimers.filter((timer) => !timer.isActive)));
      return;
    }

    console.table(prepareTableView(listOfTimers.filter((timer) => timer._id === param)));
  } catch (error) {
    console.error("error ", error);
  }
};

const formatDuration = (d) => {
  d = Math.floor(d / 1000);
  const s = d % 60;
  d = Math.floor(d / 60);
  const m = d % 60;
  const h = Math.floor(d / 60);
  return [h > 0 ? h : null, m, s]
    .filter((x) => x !== null)
    .map((x) => (x < 10 ? "0" : "") + x)
    .join(":");
};

const prepareTableView = (listOfTimers) => {
  return listOfTimers.map((timer) => {
    const { _id, description, isActive, duration, start } = timer;
    return {
      _id,
      description,
      duration: formatDuration(isActive ? new Date() - start : duration),
    };
  });
};

const start = async () => {
  console.log("Create timer:");

  try {
    const sessionId = await readFile();

    if (!sessionId) {
      console.error("You are not logged in");
      return;
    }

    const taskName = await inquirer.prompt({
      name: "taskName",
      message: "Task name",
    });

    const response = await fetch(`${url}/api/timers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        sessionId,
      },
      body: JSON.stringify(taskName),
    });

    const status = await response.status;
    if (status === 201) {
      const { taskName, id } = (await response.json()) ?? {};

      console.log("Created task " + taskName + "ID " + id);
    }
  } catch (error) {
    console.error("error ", error);
  }
};

const stop = async () => {
  console.log("Stop timer:");

  try {
    const sessionId = await readFile();

    if (!sessionId) {
      console.error("You are not logged in");
      return;
    }

    const { id } = await inquirer.prompt({
      name: "id",
      message: "Timer id",
    });

    const response = await fetch(`${url}/api/timers/${id}/stop`, {
      method: "POST",
      headers: {
        sessionId,
      },
    });

    const status = await response.status;
    console.log(`response`, response);

    if (status === 201) {
      const { id } = (await response.json()) ?? {};

      console.log(`Timer ${id} stopped.`);
    }
  } catch (error) {
    console.error("error ", error);
  }
};

const FUNC_MAPPER = {
  signup: signup,
  login: login,
  logout: logout,
  status: status,
  start: start,
  stop: stop,
};

FUNC_MAPPER[functionName]
  ? functionParam
    ? FUNC_MAPPER[functionName](functionParam)
    : FUNC_MAPPER[functionName]()
  : console.log("No such function");
