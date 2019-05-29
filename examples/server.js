
import {SmartStaticServer} from 'smart-static-server'
import {BetterNetworkConnection} from 'better-network-connection'
import {myNetworkProtocol} from './www/sharedProtocol.js'
import {createRequire} from 'module' // implement the old require function
const
  require = createRequire(import.meta.url), // now you can use require() to require whatever
  Ws = require('ws'),
  log = console.log

const server = new SmartStaticServer({
  host: 'localhost', // only connections from same computer allowed
  port: 8080,
  wsHandler: wsHandler, 
  serve: [
    {dir: 'www', as: '/'},
    {dir: 'node_modules', as: 'node_modules'}
  ],
  debug: false,
  verbose: false
})

server.start()

function wsHandler(ws) { // handle new websocket connections
  const client = new BetterNetworkConnection({
    getRandomValuesFunction: require('get-random-values'), // sadly Node.js dosen't care about standards
    webSocket: ws,
    ipAddress: ws._socket.remoteAddress, // for error messages, etc
    protocol: myNetworkProtocol,
    incomingMessageCallback: incomingMessages,
    closedConnectionCallback: info => {
      log('Client with this session key has disconnected:', info.sessionKey)
    },
    connectionReadyCallback: info => { // after session keys has been exchanged
      log('Client connected and is identified with this session key:', info.hisSessionKey)
      // it is now safe to greet him
      client.send('chat_msg', {
        from: 'Server',
        message: 'Greetings!'
      })
    },
  })

}

function incomingMessages(message) {
  log(message.command, message.data)
  if (message.command == 'chat_msg') {
    if (message.data.message.toLowerCase().search('fuck you') != -1) {
      message.sender.reply({
        replyTo: message,
        status: 'failure',
        data: {
          reason: 'Profanity will not be tolerated!'
        }
      })
      message.sender.close(1000, 'Bye bye!')
    } else {
      message.sender.reply({
        replyTo: message,
        status: 'success'
      })
    }
  }
}
