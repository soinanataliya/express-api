/*global UIkit, Vue */

(() => {
  if (!window.USER_ID) return;

  let timers = [];

  let client = new WebSocket(`ws://localhost:3000/?token=${window.USER_ID}`);

  const notification = (config) =>
    UIkit.notification({
      pos: "top-right",
      timeout: 5000,
      ...config,
    });

  const alert = (message) =>
    notification({
      message,
      status: "danger",
    });

  const info = (message) =>
    notification({
      message,
      status: "success",
    });

  const postTimerWs = async (description) => {
    client.send(
      JSON.stringify({
        type: "new_timer",
        description,
        userId: window.USER_ID,
      })
    );
  };

  const stopTimerWs = async (id) => {
    client.send(
      JSON.stringify({
        type: "stop_timer",
        id,
        userId: window.USER_ID,
      })
    );
  };

const app = new Vue({
    el: "#app",
    data: {
      desc: "",
      activeTimers: timers,
      oldTimers: timers,
    },
    methods: {
      updateTimers(newTimers) {
        console.log('newTimers', newTimers);
        this.activeTimers = newTimers.filter((timer)=> !!timer.isActive);
        this.oldTimers = newTimers.filter((timer)=> !timer.isActive);
      },
      createTimer() {
        const description = this.desc;
        this.desc = "";
        postTimerWs(description)
        info(`Created new timer "${description}"`);
      },
      stopTimer(id) {
        stopTimerWs(id)
        info(`Stop timer "${id}"`);
      },
      formatTime(ts) {
        return new Date(Number(ts)).toTimeString().split(" ")[0];
      },
      formatDuration(d) {
        d = Math.floor(d / 1000);
        const s = d % 60;
        d = Math.floor(d / 60);
        const m = d % 60;
        const h = Math.floor(d / 60);
        return [h > 0 ? h : null, m, s]
          .filter((x) => x !== null)
          .map((x) => (x < 10 ? "0" : "") + x)
          .join(":");
      },
    },
    created() {},
  });


  client.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.timers) {
      timers = timers;
    }
    console.log("recieved: ", data);
    app.updateTimers(data.timers);
  };


})();

