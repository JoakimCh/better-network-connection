
import {SmartStaticServer} from 'smart-static-server'
import {BetterNetworkConnection} from 'better-network-connection'
import {myNetworkProtocol} from './www/sharedProtocol.js'
import {createRequire} from 'module' // implement the old require function
const
  require = createRequire(import.meta.url), // now you can use require() to require whatever
  Ws = require('ws'),
  log = console.log
function sleep(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, ms)
  })
}
function bufferToHex(buffer) { // from: https://stackoverflow.com/a/53307879/4216153
  let result = '', h = '0123456789ABCDEF'
  for (let byte of new Uint8Array(buffer)) {
    result += h[byte >> 4] + h[byte & 15]
  }
  return result
}

const server = new SmartStaticServer({
  host: 'localhost', // only connections from same computer allowed
  port: 8080,
  wsHandler: wsHandler, 
  serve: [
    {dir: 'www', as: '/'},
    {dir: 'node_modules', as: 'node_modules'}
  ],
  debug: false,
  verbose: true
})

server.start()

function wsHandler(ws) { // handle new websocket connections
  const client = new BetterNetworkConnection({
    debug: true,
    getRandomValuesFunction: require('get-random-values'), // sadly Node.js dosen't care about standards
    webSocket: ws,
    ipAddress: ws._socket.remoteAddress, // for error messages, etc
    protocol: myNetworkProtocol,
    incomingMessageCallback: incomingMessages,
    closedConnectionCallback: info => {
      log('Client with this session key has disconnected:', bufferToHex(info.sessionKey))
    },
    connectionReadyCallback: info => { // after session keys has been exchanged
      log('Client connected and is identified with this session key:', bufferToHex(info.hisSessionKey))
      // it is now safe to greet him
      client.send('chat_msg', {
        from: 'Server',
        message: 'Greetings!'
      })
    },
  })

}

async function incomingMessages(message) {
  if (message.command == 'chat_msg') {
    if (message.data.message.toLowerCase().search('fuck you') != -1) {
      message.sender.reply({
        replyTo: message,
        status: 'failure',
        data: {
          reason: 'Profanity will not be tolerated!'
        }
      })
      await sleep(1000) // for fun
      message.sender.close(1000, 'Fuck you too!')
    } else {
      message.sender.reply({
        replyTo: message,
        status: 'success'
      })
    }
  }
}
