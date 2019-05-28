# better-network-connection

An ES module for sending and receiving data easily over a WebSocket.

## Features
* Can send (predefined) JavaScript objects over the network in an extremely compact binary form (much more compact than what MessagePack is able to do).
* Easily handle replies to commands (with timeout support).
* Browser and backend compatibility (standard ES module).
* Lightweight (shared buffer for all outgoing data)

## Install using NPM
```bash
npm install joakimch/better-network-connection
```

## How it works:
The desired network protocol is specified inside a JavaScript object.
The binary data structure is specified using [BetterDataView's](https://github.com/JoakimCh/better-data-view) "object template" syntax.
```javascript
const protocol = { // example protocol
  logout: null, // command with no data and no replies allowed
  login: { // command with data and both types of replies defined
    data: { // the data bundled with the login command
      nickname: 's'
    },
    failure: { // the data replied to it when it fails
      reason: 's'
    },
    success: { // the data replied to it when it succeeds
      userCount: 'u8',
      users: ['this.userCount', {
        id: 'u8',
        nickname: 's'
      }]
    }
    // the failure and success objects are optional 
    // (if no replies are needed they can be omitted)
  }
  echo: { // a command that can receive a success reply
    success: null // but where no additional data is needed in the reply
  }
}
```
1. Each packet starts with a command ID consisting of 8 or 16 bits (depending on how many commands are defined).
2. Packets which can be replied to also has a 16 bit message ID (so the reply can target this spesific packet).
3. The packet will only have additional data if specified in the protocol.

Every connection will also be sent a unique session key which can be used to identify the client upon reconnection (client can choose to use it or not).

## Examples
```javascript
import {BetterNetworkConnection} from "better-network-connection"

const myNetworkProtocol = {
  chat_msg: {
    data: {
      from: 's',
      message: 's'
    },
    success: null,
    failure: {
      reason: 's'
    }
    //error: {/*You can not customize this one...*/}
  }
}

const server = new BetterNetworkConnection({
  webSocket: new WebSocket('ws://localhost:8080'),
  protocol: myNetworkProtocol,
  incomingMessageCallback: incomingMessages,
  closedConnectionCallback: closedConnection,
  mySessionKeyCallback: gotSessionKey
})

function gotSessionKey(sessionKey) {
  console.log('My session key:', sessionKey)
}

function incomingMessages(message) {
  console.log('Message from server:', message)
  switch (message.command) {
    case 'chat_msg': {
      let nickname = message.data.from
      let message = message.data.message
      console.log(nickname+':', message)
    } break
  }
}

function closedConnection() {
  console.log('Server closed connection')
}

async function sendMessage(from, message) {
  let reply = await server.send('chat_msg', {
    from,
    message
  })
  switch (reply.status) {
    case 'success':
      console.log('Message received by server')
    break
    case 'failure':
      console.log('Server did not accept message:', reply.data.reason)
    break
    case 'error':
      console.error('Server error:', reply.data)
      // An 'error' status will always result in a message stored in reply.data,
      // you can not customize it.
    break
  }
}

server.webSocket.addListener('open', { // addEventListener if using browser
  sendMessage('SugarDaddy62', 'ASL?')
})
```
Reply as a callback:
```javascript
server.send('chat_msg', {
  from: 'Santa',
  message: 'Ho ho ho!'
}, reply => {
  console.log(reply.status)
})
```

## Todo
- [ ] Provide better documentation and examples.
- [ ] Purge old reply callbacks (timed out replies). Using a timer called every 1 second (3 seconds = timed out or have option to set timeout).
- [ ]  Allow to set size of out-buffer or change it dynamicly?

## WARNING (please read)

### This is a one-man project put here mostly to serve myself, not the public. Hence there might be bugs, missing or incomplete features. And I might not care about "industry standards", your meanings or doing things in any other way than MY way.

### But I do believe that this project can be useful to others, so rest assured that I will not remove it. Feel free to use it and spread the word about it, but never expect anything from me!

If you want to contribute to the project you might be better off by forking it, I don't have much time or energy to manage an open source project. If you fixed a bug I will probably accept the pull request though.
