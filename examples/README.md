# How to run the examples

From the `examples` directory run `npm install` to install the dependencies used by the examples. Then you can run `server.js` with this command `node --experimental-modules server.js`.

You will then be greeted with this output:
```
(node:19369) ExperimentalWarning: The ESM module loader is experimental.
HTTP server started, listening at: { address: '127.0.0.1', family: 'IPv4', port: 8080 }
Local server only reachable at localhost/127.0.0.1 (only this computer can connect)
http://127.0.0.1:8080
```
Go to [that address](http://127.0.0.1:8080) to run the `client.js` script and see it in action by pressing F12 in your browser (so you can see the console output). _Make sure you use a proper browser like the latest version of Chromium/Chrome or Firefox._

These examples demonstrates how the same module can function unmodified in both the backend and the frontend without needing any tools/compilers.
