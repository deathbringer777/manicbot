module.exports = {
  commands: {
    "/crontab": {
      // Alias of the unified /cron renderer (humanized schedules + bot registry).
      // Lazy require avoids a load-time cycle with commands.js.
      handler: async () => require("../commands.js").renderCron(),
      description: "Запланированные задачи (= /cron)",
    },
  },
};
