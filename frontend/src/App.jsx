import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';

const App = () => {
  const [code, setCode] = useState('name = input("Enter your name: ")\nprint("Hello, " + name)');
  const [language, setLanguage] = useState('python');
  const [terminalOutput, setTerminalOutput] = useState([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [filename, setFilename] = useState('code.py');
  const [retryCount, setRetryCount] = useState(0);
  const wsRef = useRef(null);
  const terminalRef = useRef(null);
  const inputRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const MAX_RETRIES = 5;

  // Default boilerplate codes
  const boilerplates = {
    python: 'name = input("Enter your name: ")\nprint("Hello, " + name)',
    javascript: 'console.log("Hello, World!");',
    java: `// Note: Do not change the class name 'Main' as it is required for compilation\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`
  };

  // Update code and filename when language changes
  useEffect(() => {
    setCode(boilerplates[language]);
    setFilename(language === 'java' ? 'Main.java' : `code.${language === 'python' ? 'py' : 'js'}`);
  }, [language]);

  const connectWebSocket = () => {
    // Close existing connection and clear any pending retries
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    // Check retry limit
    if (retryCount >= MAX_RETRIES) {
      setTerminalOutput((prev) => [
        ...prev,
        { type: 'error', content: 'Failed to connect to server after multiple attempts. Please check if the server is running on ws://localhost:5001 and refresh the page.' }
      ]);
      setRetryCount(0); // Reset for future attempts
      return;
    }

    // wsRef.current = new WebSocket('wss://backend-production-7526.up.railway.app');

    wsRef.current = new WebSocket('ws://localhost:5001');

;

    wsRef.current.onopen = () => {
      setTerminalOutput((prev) => [...prev, { type: 'info', content: 'Connected to server' }]);
      setRetryCount(0); // Reset retry count on successful connection
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'output' || data.type === 'error') {
        setTerminalOutput((prev) => [...prev, { type: data.type, content: data.data }]);
        if (data.type === 'output' && isRunning) {
          inputRef.current?.focus();
        }
      } else if (data.type === 'done') {
        setTerminalOutput((prev) => [...prev, { type: 'info', content: data.data }]);
        setIsRunning(false);
      }
    };

    wsRef.current.onclose = () => {
      setTerminalOutput((prev) => [...prev, { type: 'error', content: 'Disconnected from server. Reconnecting...' }]);
      setIsRunning(false);
      setRetryCount((prev) => prev + 1);
      retryTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    };

    wsRef.current.onerror = () => {
      wsRef.current.close();
    };
  };

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  const runCode = () => {
    if (isRunning || wsRef.current?.readyState !== WebSocket.OPEN) {
      setTerminalOutput((prev) => [...prev, { type: 'error', content: 'Cannot run: Server not connected or another program is running' }]);
      return;
    }
    setIsRunning(true);
    setTerminalOutput([{ type: 'info', content: 'Running program...' }]);
    wsRef.current.send(JSON.stringify({ type: 'run', code, language }));
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleInputSubmit = (e) => {
    if (e.key === 'Enter' && currentInput.trim() !== '' && isRunning) {
      setTerminalOutput((prev) => [...prev, { type: 'input', content: currentInput }]);
      wsRef.current.send(JSON.stringify({ type: 'input', input: currentInput }));
      setCurrentInput('');
    }
  };

  const downloadCode = () => {
    try {
      const blob = new Blob([code], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'code.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setTerminalOutput((prev) => [
        ...prev,
        { type: 'info', content: `Code downloaded as ${filename || 'code.txt'}.` }
      ]);
    } catch (error) {
      setTerminalOutput((prev) => [
        ...prev,
        { type: 'error', content: `Error downloading code: ${error.message}` }
      ]);
    }
  };

  return (
    <div className="min-h-screen p-6 bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Code Editor</h1>
        <div className="flex gap-4 mb-4 items-center">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="p-2 rounded border bg-gray-800 border-gray-600 text-white"
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="java">Java</option>
          </select>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="Filename"
            className="p-2 rounded border w-40 bg-gray-800 border-gray-600 text-white"
          />
          <button
            onClick={runCode}
            disabled={isRunning}
            className={`px-4 py-2 rounded text-white ${
              isRunning ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isRunning ? 'Running...' : 'Run Code'}
          </button>
          <button
            onClick={downloadCode}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
          >
            Download Code
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded overflow-hidden border-gray-600">
            <Editor
              height="500px"
              language={language}
              value={code}
              onChange={setCode}
              theme="vs-dark"
              options={{ 
                minimap: { enabled: false },
                fontSize: 14
              }}
            />
          </div>
          <div className="border rounded p-4 h-[500px] flex flex-col" style={{
            backgroundColor: '#1e1e1e',
            borderColor: '#374151'
          }}>
            <h2 className="font-bold mb-2 text-white">Terminal</h2>
            <div ref={terminalRef} className="flex-1 overflow-auto font-mono text-sm p-2">
              {terminalOutput.map((item, index) => (
                <div key={index} className="mb-1">
                  {item.type === 'output' && (
                    <pre className="text-white whitespace-pre-wrap">{item.content}</pre>
                  )}
                  {item.type === 'input' && (
                    <pre className="text-green-400 whitespace-pre-wrap">{'>'} {item.content}</pre>
                  )}
                  {item.type === 'error' && (
                    <pre className="text-red-400 whitespace-pre-wrap">{item.content}</pre>
                  )}
                  {item.type === 'info' && (
                    <pre className="text-blue-400 whitespace-pre-wrap">{item.content}</pre>
                  )}
                </div>
              ))}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={currentInput}
              onChange={(e) => setCurrentInput(e.target.value)}
              onKeyDown={handleInputSubmit}
              placeholder={isRunning ? "Enter input here..." : "Run code to start"}
              disabled={!isRunning}
              className="w-full p-2 mt-2 rounded font-mono text-sm bg-gray-800 text-white"
              style={{
                borderColor: '#374151'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;