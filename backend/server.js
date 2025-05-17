const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const WebSocket = require('ws');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Create directories if they don't exist
const CODE_DIR = path.join(__dirname, 'saved_codes');
const TEMP_DIR = path.join(__dirname, 'temp');

const ensureDirectories = async () => {
  try {
    await fs.mkdir(CODE_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    // Clean temp directory on startup
    const files = await fs.readdir(TEMP_DIR);
    for (const file of files) {
      try {
        await fs.unlink(path.join(TEMP_DIR, file));
      } catch (err) {
        console.error(`Failed to delete temp file ${file}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`Failed to initialize directories: ${err.message}`);
  }
};

ensureDirectories();

// Set up WebSocket server
const wss = new WebSocket.Server({ port: 5001 });

wss.on('connection', (ws) => {
  let runProcess = null;
  let filePath = null;

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', data: 'Invalid message format' }));
      return;
    }

    const { type, code, language, input } = data;

    if (type === 'run') {
      if (runProcess) {
        ws.send(JSON.stringify({ type: 'error', data: 'Another program is running' }));
        return;
      }

      switch (language) {
        case 'python':
          filePath = path.join(TEMP_DIR, 'code.py');
          try {
            await fs.writeFile(filePath, code);
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', data: `Failed to write code file: ${err.message}` }));
            return;
          }
          runProcess = spawn('python', [filePath]);
          break;
        case 'javascript':
          filePath = path.join(TEMP_DIR, 'code.js');
          try {
            await fs.writeFile(filePath, code);
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', data: `Failed to write code file: ${err.message}` }));
            return;
          }
          runProcess = spawn('node', [filePath]);
          break;
        case 'java':
          filePath = path.join(TEMP_DIR, 'Main.java');
          try {
            await fs.writeFile(filePath, code);
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', data: `Failed to write code file: ${err.message}` }));
            return;
          }
          await new Promise((resolve) => {
            exec(`cd "${TEMP_DIR}" && javac Main.java`, (err, stdout, stderr) => {
              if (err || stderr) {
                ws.send(JSON.stringify({ type: 'error', data: stderr || err.message }));
                resolve();
                return;
              }
              resolve();
            });
          });
          runProcess = spawn('java', ['Main'], { cwd: TEMP_DIR });
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', data: 'Unsupported language' }));
          return;
      }

      runProcess.stdout.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
      });

      runProcess.stderr.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'error', data: data.toString() }));
      });

      runProcess.on('close', async (code) => {
        ws.send(JSON.stringify({ type: 'done', data: `Program finished (exit code: ${code})` }));
        if (filePath) {
          try {
            if (await fs.access(filePath).then(() => true).catch(() => false)) {
              await fs.unlink(filePath);
            }
          } catch (err) {
            console.error(`Failed to delete ${filePath}: ${err.message}`);
          }
        }
        if (language === 'java') {
          const classFile = path.join(TEMP_DIR, 'Main.class');
          try {
            if (await fs.access(classFile).then(() => true).catch(() => false)) {
              await fs.unlink(classFile);
            }
          } catch (err) {
            console.error(`Failed to delete ${classFile}: ${err.message}`);
          }
        }
        runProcess = null;
        filePath = null;
      });

      runProcess.on('error', async (err) => {
        ws.send(JSON.stringify({ type: 'error', data: `Process error: ${err.message}` }));
        if (filePath) {
          try {
            if (await fs.access(filePath).then(() => true).catch(() => false)) {
              await fs.unlink(filePath);
            }
          } catch (err) {
            console.error(`Failed to delete ${filePath}: ${err.message}`);
          }
        }
        runProcess = null;
        filePath = null;
      });
    } else if (type === 'input' && runProcess) {
      try {
        runProcess.stdin.write(input + '\n');
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', data: `Failed to send input: ${err.message}` }));
      }
    }
  });

  ws.on('close', async () => {
    if (runProcess) {
      runProcess.kill();
      runProcess = null;
    }
    if (filePath) {
      try {
        if (await fs.access(filePath).then(() => true).catch(() => false)) {
          await fs.unlink(filePath);
        }
      } catch (err) {
        console.error(`Failed to delete ${filePath}: ${err.message}`);
      }
    }
    filePath = null;
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error: ${err.message}`);
  });
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`HTTP server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:5001`);
  console.log(`CORS enabled for all origins`);
});