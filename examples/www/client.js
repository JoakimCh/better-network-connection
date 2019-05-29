
import {BetterNetworkConnection} from './node_modules/better-network-connection/source/BetterNetworkConnection.js'
import {myNetworkProtocol} from './sharedProtocol.js'
const log = console.log

log('Connecting to server...')

const server = new BetterNetworkConnection({
  webSocket: new WebSocket('ws://'+location.hostname+':'+location.port),
  protocol: myNetworkProtocol,
  incomingMessageCallback: incomingMessages,
  connectionReadyCallback: connectionReady, // after session keys has been shared
  closedConnectionCallback: info => {
    log('The server has closed the connecton, how rude!', info.code, info.reason)
  },
})

function incomingMessages(message) {
  log("Received:", message.command, message.data)
  if (message.command == 'chat_msg') {
    server.reply({
      replyTo: message, // use this
      /*command: message.command, // or manually enter these values
      messageId: message.id,*/
      status: 'success'
    })
  }
}

function connectionReady(info) {
  log('Connected! My session key is:', info.mySessionKey)
  // send our first message
  let data = {
    from: 'Client',
    message: 'Hello you! ♥'
  }
  let dataBeforeCallback = Object.assign({}, data) // copies it
  server.send('chat_msg', data, reply => {
    if (reply.status == 'success') {
      console.log('Server successfully received your message:', dataBeforeCallback)
    }
  })
  // send our second message
  data = {
    from: 'Client',
    message: 'Fuck you!'
  }
  let reply = await server.send('chat_msg', data)
  if (reply.status == 'failure') {
    console.log('Server didn\'t like your message:', data)
    console.log('Reason:', reply.data.reason)
  }
})
