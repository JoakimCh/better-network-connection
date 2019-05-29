
import {BetterNetworkConnection} from './node_modules/better-network-connection/source/BetterNetworkConnection.js'
import {myNetworkProtocol} from './sharedProtocol.js'
const log = console.log
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

log('Connecting to server...')

const server = new BetterNetworkConnection({
  debug: true,
  webSocket: new WebSocket('ws://'+location.hostname+':'+location.port),
  protocol: myNetworkProtocol,
  incomingMessageCallback: incomingMessages,
  connectionReadyCallback: connectionReady, // after session keys has been shared
  closedConnectionCallback: info => {
    log('The server has closed the connecton, how rude! Code and reason:', info.code, info.reason)
  },
})

function incomingMessages(message) {
  if (message.command == 'chat_msg') {
    server.reply({
      replyTo: message, // use this
      /*command: message.command, // or manually enter these values
      messageId: message.id,*/
      status: 'success'
    })
  }
}

async function connectionReady(info) {
  log('Connected! My session key is:', bufferToHex(info.mySessionKey))
  await sleep(1000) // for fun
  // send our first message
  server.send('chat_msg', {
    from: 'Client',
    message: 'Hello you! ♥'
  }, reply => {
    if (reply.status == 'success') {
      log('Server successfully received my message!')
    }
  })
  await sleep(1000) // for fun
  // send our second message
  let reply = await server.send('chat_msg', {
    from: 'Client',
    message: 'Fuck you!'
  })
  if (reply.status == 'failure') {
    log('Server didn\'t like my message :(')
    log('Reason:', reply.data.reason)
  }
}
