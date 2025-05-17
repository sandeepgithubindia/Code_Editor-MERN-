require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 5000;
const SOCKETPORT = process.env.SOCKETPORT || 5001;

// Directories
const CODE_DIR = path.join(__dirname, 'saved_codes');
const TEMP_DIR = path.join(__dirname, 'temp');

// Middleware
app.use(cors());
app.use(express.json());

// Ensure directories and clean temp folder
const ensureDirectories = async () => {
  try {
    await fs.mkdir(CODE_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const files = await fs.readdir(TEMP_DIR);
    for (const file of files) {
      await fs.unlink(path.join(TEMP_DIR, file)).catch(() => {});
    }
  } catch (err) {
    console.error('Error initializing directories:', err.message);
  }
};

ensureDirectories();

// Express route for testing
app.get('/', (req, res) => {
  res.send('Compiler API is running.');
});

// WebSocket Server
const wss = new WebSocket.Server({ port: SOCKETPORT });

wss.on('connection', (ws) => {
  let runProcess = null;
  let filePath = null;

  ws.on('message', async (message) => {
    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', data: 'Invalid message format' }));
      return;
    }

    const { type, code, language, input } = payload;

    if (type === 'run') {
      if (runProcess) {
        ws.send(JSON.stringify({ type: 'error', data: 'Another program is running' }));
        return;
      }

      switch (language) {
        case 'python':
          filePath = path.join(TEMP_DIR, 'code.py');
          await fs.writeFile(filePath, code);
          runProcess = spawn('python', [filePath]);
          break;

        case 'javascript':
          filePath = path.join(TEMP_DIR, 'code.js');
          await fs.writeFile(filePath, code);
          runProcess = spawn('node', [filePath]);
          break;

        case 'java':
          filePath = path.join(TEMP_DIR, 'Main.java');
          await fs.writeFile(filePath, code);
          await new Promise((resolve) => {
            exec(`cd "${TEMP_DIR}" && javac Main.java`, (err, _, stderr) => {
              if (err || stderr) {
                ws.send(JSON.stringify({ type: 'error', data: stderr || err.message }));
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

        try {
          if (filePath && await fileExists(filePath)) await fs.unlink(filePath);
          if (language === 'java') {
            const classFile = path.join(TEMP_DIR, 'Main.class');
            if (await fileExists(classFile)) await fs.unlink(classFile);
          }
        } catch (err) {
          console.error('Cleanup error:', err.message);
        }

        runProcess = null;
        filePath = null;
      });

      runProcess.on('error', async (err) => {
        ws.send(JSON.stringify({ type: 'error', data: `Process error: ${err.message}` }));
        if (filePath && await fileExists(filePath)) await fs.unlink(filePath);
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
    if (runProcess) runProcess.kill();
    if (filePath && await fileExists(filePath)) await fs.unlink(filePath);
    filePath = null;
    runProcess = null;
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

// Utility: Check if file exists
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

// Start server
app.listen(PORT, () => {
  console.log(`HTTP server running at http://localhost:${PORT}`);
  console.log(`WebSocket server running at ws://localhost:${SOCKETPORT}`);
});
