const runStartupTasks = async (tasks = []) => {
  for (const task of tasks) {
    await task();
  }
};

module.exports = { runStartupTasks };
