const fs = require("fs");
const path = require("path");

const TODO_FILE = path.join(__dirname, "..", "todo.json");

function readTodos() {
  try { return JSON.parse(fs.readFileSync(TODO_FILE, "utf8")); }
  catch { return []; }
}

function writeTodos(todos) {
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

module.exports = {
  commands: {
    "/todo": {
      handler: async (chatId, arg) => {
        if (!arg) {
          const todos = readTodos();
          if (!todos.length) return "✅ Список задач пуст";
          const done = todos.filter(t => t.done).length;
          const lines = todos.map((t, i) => `  ${t.done ? "✅" : "⬜"} ${i + 1}. ${t.text}${t.done ? "" : ""}`).join("\n");
          return `📋 Список задач (${done}/${todos.length}):\n${lines}\n\n/add <текст> — добавить\n/done <номер> — отметить`;
        }

        const parts = arg.split(/\s+/);
        const sub = parts[0].toLowerCase();
        const rest = parts.slice(1).join(" ");

        if (sub === "add" && rest) {
          const todos = readTodos();
          todos.push({ text: rest, done: false, created: new Date().toISOString() });
          writeTodos(todos);
          return `✅ Добавлено: "${rest}"`;
        }

        if (sub === "done" && rest) {
          const idx = parseInt(rest, 10) - 1;
          const todos = readTodos();
          if (idx < 0 || idx >= todos.length) return "❌ Неверный номер задачи";
          todos[idx].done = true;
          writeTodos(todos);
          return `✅ Задача #${rest} отмечена выполненной`;
        }

        if (sub === "del" && rest) {
          const idx = parseInt(rest, 10) - 1;
          const todos = readTodos();
          if (idx < 0 || idx >= todos.length) return "❌ Неверный номер задачи";
          const removed = todos.splice(idx, 1)[0];
          writeTodos(todos);
          return `🗑 Удалено: "${removed.text}"`;
        }

        if (sub === "clear") {
          writeTodos([]);
          return "🗑 Список задач очищен";
        }

        const todos = readTodos();
        if (!todos.length) return "✅ Список задач пуст";
        const lines = todos.map((t, i) => `  ${t.done ? "✅" : "⬜"} ${i + 1}. ${t.text}`).join("\n");
        return `📋 Задачи:\n${lines}\n\nИспользование:\n/todo add <текст>\n/todo done <номер>\n/todo del <номер>\n/todo clear`;
      },
      description: "Менеджер задач: /todo add купить молоко",
    },
  },
};
