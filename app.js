"use strict";

const $ = (id) => document.getElementById(id);

const EXAMPLE_CODE = `print("Привет, мир!")
print("Добро пожаловать в PyPlayground!")

name = input("Как тебя зовут? ")
print(f"Приятно познакомиться, {name}!")

print()
print("Считаем числа:")
for i in range(1, 6):
    print(f"{i} × {i} = {i * i}")
`;

const STORAGE = {
  code: "pyplayground-code",
  theme: "pyplayground-theme"
};

let editor = null;
let pyodide = null;
let pyodideReady = false;
let isRunning = false;
let executionStarted = 0;
let executionTimer = null;
let currentRunId = 0;

const statusDot = document.querySelector(".status-dot");

function setRuntimeStatus(text, state = "loading") {
  $("runtimeStatus").lastChild.textContent = " " + text;
  statusDot.className = "status-dot";

  if (state === "ready") statusDot.classList.add("ready");
  if (state === "error") statusDot.classList.add("error");
}

function setExecutionStatus(text) {
  $("executionStatus").textContent = text;
}

function addConsoleLine(text = "", type = "") {
  const consoleElement = $("console");
  const welcome = consoleElement.querySelector(".welcome-message");

  if (welcome) welcome.remove();

  const line = document.createElement("div");
  line.className = "console-line" + (type ? " " + type : "");
  line.textContent = text;

  consoleElement.appendChild(line);
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

function clearConsole() {
  $("console").replaceChildren();
  $("executionTime").textContent = "";
  setExecutionStatus("Консоль очищена");
}

function showWelcome() {
  $("console").innerHTML = `
    <div class="welcome-message">
      <div class="welcome-icon">🐍</div>
      <h2>Добро пожаловать!</h2>
      <p>Напиши Python-код и нажми «Запустить».</p>
      <p class="muted">Результат появится здесь.</p>
    </div>
  `;
}

function setRunningState(running) {
  isRunning = running;
  $("runBtn").disabled = running || !pyodideReady;
  $("stopBtn").disabled = !running;
  $("runBtn").innerHTML = running
    ? "<span>◌</span> Выполняется..."
    : "<span>▶</span> Запустить";
}

function getCode() {
  return editor ? editor.getValue() : EXAMPLE_CODE;
}

// ---------- Тема ----------

function applyTheme(theme) {
  const isLight = theme === "light";

  document.body.classList.toggle("light", isLight);
  $("themeBtn").textContent = isLight ? "🌙" : "☀️";
  $("themeBtn").title = isLight ? "Включить тёмную тему" : "Включить светлую тему";

  if (editor) {
    monaco.editor.setTheme(isLight ? "vs" : "vs-dark");
  }

  try {
    localStorage.setItem(STORAGE.theme, theme);
  } catch (_) {}
}

$("themeBtn").addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("light")
    ? "dark"
    : "light";

  applyTheme(nextTheme);
});

// ---------- Monaco Editor ----------

function initEditor() {
  return new Promise((resolve, reject) => {
    if (typeof require === "undefined") {
      reject(new Error("Не удалось загрузить Monaco Editor."));
      return;
    }

    require.config({
      paths: {
        vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs"
      }
    });

    require(["vs/editor/editor.main"], () => {
      try {
        let savedCode = EXAMPLE_CODE;

        try {
          savedCode = localStorage.getItem(STORAGE.code) || EXAMPLE_CODE;
        } catch (_) {}

        editor = monaco.editor.create($("editor"), {
          value: savedCode,
          language: "python",
          theme: "vs-dark",
          automaticLayout: true,
          fontSize: 14,
          lineHeight: 22,
          fontFamily: "'Cascadia Code', Consolas, monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          roundedSelection: true,
          padding: { top: 14, bottom: 14 },
          cursorBlinking: "smooth",
          smoothScrolling: true,
          tabSize: 4,
          insertSpaces: true,
          wordWrap: "on",
          renderLineHighlight: "all",
          bracketPairColorization: { enabled: true },
          suggestOnTriggerCharacters: true,
          quickSuggestions: true
        });

        editor.onDidChangeCursorPosition((event) => {
          $("cursorPosition").textContent =
            `Строка ${event.position.lineNumber}, столбец ${event.position.column}`;
        });

        let saveTimeout;

        editor.onDidChangeModelContent(() => {
          $("savedIndicator").classList.add("visible");
          clearTimeout(saveTimeout);

          saveTimeout = setTimeout(() => {
            try {
              localStorage.setItem(STORAGE.code, getCode());
            } catch (_) {}

            $("savedIndicator").classList.remove("visible");
          }, 400);
        });

        applyTheme(readTheme());
        resolve();
      } catch (error) {
        reject(error);
      }
    }, reject);
  });
}

function readTheme() {
  try {
    return localStorage.getItem(STORAGE.theme) || "dark";
  } catch (_) {
    return "dark";
  }
}

// ---------- Pyodide ----------

async function initPython() {
  if (typeof loadPyodide !== "function") {
    throw new Error("Не удалось загрузить Pyodide. Проверь подключение к CDN.");
  }

  pyodide = await loadPyodide({
    stdout: (text) => addConsoleLine(text),
    stderr: (text) => addConsoleLine(text, "error"),
    stdin: () => {
      // input() в Python синхронный.
      // Поэтому для первой версии используется диалог браузера.
      const value = window.prompt("Python input(): введи значение:");

      if (value === null) {
        return 10; // Enter
      }

      // Pyodide ожидает коды символов по одному.
      const chars = Array.from(value + "\n");
      stdinBuffer = chars.map((char) => char.codePointAt(0));
      stdinIndex = 0;

      return readStdinCharacter();
    }
  });

  pyodideReady = true;
}

let stdinBuffer = [];
let stdinIndex = 0;

function readStdinCharacter() {
  if (stdinIndex >= stdinBuffer.length) {
    return 10;
  }

  return stdinBuffer[stdinIndex++];
}

// ---------- Запуск программы ----------

async function runCode() {
  if (!pyodideReady || !pyodide || isRunning) return;

  const code = getCode();

  currentRunId++;
  const runId = currentRunId;

  clearConsole();
  setRunningState(true);
  setExecutionStatus("Выполнение программы...");
  executionStarted = performance.now();

  addConsoleLine("▶ Запуск Python...", "system");

  $("inputArea").classList.add("hidden");

  executionTimer = setInterval(() => {
    if (isRunning) {
      $("executionTime").textContent =
        ((performance.now() - executionStarted) / 1000).toFixed(2) + " с";
    }
  }, 100);

  try {
    // Важно: каждый запуск получает новый Python-код,
    // но глобальные переменные сохраняются между запусками.
    await pyodide.runPythonAsync(code);

    if (runId !== currentRunId) return;

    addConsoleLine("✓ Выполнение завершено.", "system");
    setExecutionStatus("Выполнено");
  } catch (error) {
    if (runId !== currentRunId) return;

    addConsoleLine(String(error), "error");
    setExecutionStatus("Ошибка выполнения");
  } finally {
    if (runId === currentRunId) {
      clearInterval(executionTimer);
      executionTimer = null;
      setRunningState(false);

      $("executionTime").textContent =
        ((performance.now() - executionStarted) / 1000).toFixed(2) + " с";
    }
  }
}

$("runBtn").addEventListener("click", runCode);

// Ctrl+Enter запускает программу.
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runCode();
  }
});

// ---------- Кнопки ----------

$("clearBtn").addEventListener("click", () => {
  clearConsole();
});

$("resetBtn").addEventListener("click", () => {
  if (editor && !isRunning) {
    editor.setValue(EXAMPLE_CODE);
    editor.focus();
  }
});

$("downloadBtn").addEventListener("click", () => {
  const blob = new Blob([getCode()], {
    type: "text/x-python;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "main.py";
  link.click();

  URL.revokeObjectURL(url);
});

$("stopBtn").addEventListener("click", () => {
  if (!isRunning) return;

  // Нельзя надёжно прервать произвольный Python-код,
  // выполняющийся в основном потоке Pyodide.
  addConsoleLine(
    "Прерывание произвольного Python-кода в этой версии не поддерживается. " +
    "Перезагрузи страницу, если программа зависла.",
    "error"
  );
});

// ---------- Инициализация ----------

async function main() {
  setRuntimeStatus("Загрузка редактора...");

  try {
    await initEditor();

    setRuntimeStatus("Загрузка Python...");
    await initPython();

    setRuntimeStatus("Python готов", "ready");
    setExecutionStatus("Готов к запуску");
    $("runBtn").disabled = false;
  } catch (error) {
    console.error(error);

    setRuntimeStatus("Ошибка загрузки", "error");
    setExecutionStatus("Не удалось запустить Python");

    addConsoleLine(
      "Ошибка инициализации: " + (error.message || String(error)),
      "error"
    );

    addConsoleLine(
      "Проверь интернет, доступность CDN и консоль браузера (F12).",
      "system"
    );
  }
}

main();
