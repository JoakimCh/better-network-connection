import {BetterDataView} from '../../better-data-view/source/BetterDataView.js'
import Mutex from '../../await-mutex/source/AwaitMutex.js'

function mandatory(msg='') {throw new Error('Missing parameter! '+msg)}

const replyStatus = {
  failure: 2, // the meaning is up to you
  success: 1, // the meaning is up to you
  error: 0, // indicating that the receiver didn't understand the command or crashed running it
}

class BNC {
  constructor({ // options object
    webSocket = mandatory(), // must be given an open websocket connection
    protocol = mandatory('A protocol must be defined'),
    incomingMessageCallback = mandatory(), // called at incoming commands: ({client, command, data})
    closedConnectionCallback, // called at closed connection: (client, reason)
    getRandomValuesFunction = crypto.getRandomValues.bind(crypto), // in the future: globalThis.crypto (when NodeJS has support for it)  // https://stackoverflow.com/questions/10743596/why-are-certain-function-calls-termed-illegal-invocations-in-javascript
    mySessionKey, // used when you want to identify yourself with a key the peer remembers
    connectionReadyCallback, //mySessionKeyCallback, // called when you have been given a session key
    ipAddress,
    debug = false // true for debug messages
  }) {
    if (debug) {
      this._debug = (...args) => {console.log(...args)}
    } else {
      this._debug = ()=>{} // Calls to this should be optimized away by the JavaScript engine?
    }
    this._initializeProtocol(protocol)
    this._replyCallbacks = new Map()
    this._sessionKey // the session key used to identify the other side
    this._mySessionKey // the session key given to you by the other side
    this._msgId = 1 // current msgId added to messages so replies to it can be tracked
    this._commandCallback = incomingMessageCallback
    this._closedConnectionCallback = closedConnectionCallback
    this._getRandomValuesFunction = getRandomValuesFunction
    this._connectionReadyCallback = connectionReadyCallback //this._mySessionKeyCallback = mySessionKeyCallback
    this._ws = webSocket
    this._ws.binaryType = 'arraybuffer'
    this._ws.addEventListener('message', this._onMessage.bind(this))
    this._ws.addEventListener('close', this._onClose.bind(this))
    this._ipAddress = ipAddress || 'UNKNOWN_IP'
    
    let onOpen = (() => {
      if (mySessionKey) {
        if (mySessionKey instanceof Uint8Array && mySessionKey.length == 8) { // that's a 64bit key
          this._mySessionKey = mySessionKey
          this._sendSessionKey()
        } else {
          throw Error('mySessionKey given, but is not a Uint8Array with 8 bytes')
        }
      } else {
        this._requestSessionKey()
      }
    }).bind(this)
    
    if (this._ws.readyState == this._ws.CONNECTING) {
      this._ws.addEventListener('open', onOpen)
    } else if (this._ws.readyState == this._ws.OPEN) {
      onOpen()
    } else {
      throw Error('Is the WebSocket closed? A ws.readyState like this is not accepted:', ws.readyState)
    }

  }
  
  get webSocket() {return this._ws}

  _initializeProtocol(protocol) {
    if (BNC._protocolCache.has(protocol)) {
      this._protocol = BNC._protocolCache.get(protocol)
    } else {
      this._protocol = {
        _internal_reply: null,
        // sent to request a session key which can be used as an unique identifier
        _internal_session_requestKey: {
          success: {
            sessionKey: 'u8,8' // array of 8 bytes
          }
        },
        // message containing a session key, this is used to allow the other side to recognize this peer
        _internal_session_key: {
          data: {
            sessionKey: 'u8,8'
          },
          success: null
        },
        // the user defined protocol
        ...protocol
      }
      let commandArray = [], nextCommandId = 0
      for (let key in this._protocol) {
        if (this._protocol[key] == null) { // value null is also an object btw
          this._protocol[key] = {}
        }
        if ('success' in this._protocol[key] || 'failure' in this._protocol[key]) {
          this._protocol[key]._canBeRepliedTo = true
        } else {
          this._protocol[key]._canBeRepliedTo = false
        }
        //this._debug(key, this._protocol[key], typeof this._protocol[key])
        this._protocol[key]._commandId = nextCommandId++ // store the command id
        commandArray.push(key) // an array of all the command strings (index can be used to calculate the commandId)
      }
      let commandIdByteSize
      if (nextCommandId <= 256) {
        commandIdByteSize = 1
      } else {
        commandIdByteSize = 2
      }
      this._protocol._commandIdByteSize = commandIdByteSize
      this._protocol._commandArray = commandArray
      BNC._protocolCache.set(protocol, this._protocol) // cache the modified object so we don't have to do this processing again for each connection
    }
  }
  
  get _newMsgId() { // 16 bit maximum
    if (this._msgId >= 65535) {
      this._msgId = 1 // we skip 0 since it is "false"
    } else {
      this._msgId++
    }
    return this._msgId
  }
  
  get sessionKey() { // that's the session key the peer has
    return this._sessionKey
  }

  _callReadyCallbackIfReady() {
    if (this._sessionKey && this._mySessionKey) {
      if (typeof this._connectionReadyCallback == 'function') {
        this._connectionReadyCallback({
          mySessionKey: this._mySessionKey,
          hisSessionKey: this._sessionKey
        })
      }
    }
  }
  
  _replyCallback(msgId, command, callback) { // returns a Promise if callback not set
    if (typeof callback == 'function') { // todo: have timeout for waiting callbacks also
      this._replyCallbacks.set(msgId, {
        callback, 
        timestamp: Date.now(),
        command
      }) // Date.now() = milliseconds elapsed since January 1, 1970 00:00:00 UTC
      return null
    } else {
      return new Promise((resolve, reject) => {
        this._replyCallbacks.set(msgId, {
          callback: reply => {
            resolve(reply)
          },
          timestamp: Date.now(),
          command
        })
        setTimeout(()=>{
          resolve({status: 'error', data: {message: 'Reply timeout'}}) // reject({status: 'serverError'})
        }, 2000)
      })
    }
  }
  
  async send(command, data, replyCallback) {
    this._debug('send:', command, data)
    if (!(command in this._protocol)) {
      throw Error('Command "'+command+'" was not found in the provided network protocol')
    }
    let messageId = null
    if (this._protocol[command]._canBeRepliedTo) {
      messageId = this._newMsgId
    }
    const dataOut_unlock = await BNC._dataOut_mutex.lock()
    try {
      BNC._dataOut.start() // seek to start
      if (this._protocol._commandIdByteSize == 1) {
        BNC._dataOut.u8(this._protocol[command]._commandId)
      } else {
        BNC._dataOut.u16(this._protocol[command]._commandId)
      }
      if (this._protocol[command]._canBeRepliedTo) {
        BNC._dataOut.u16(messageId)
      }
      if (data) {
        if ('data' in this._protocol[command]) {
          BNC._dataOut.writeObject(this._protocol[command].data, data)
        } else {
          throw Error('Trying to send data, but no data defined in protocol for: '+command)
        }
      }
      this._ws.send(BNC._dataOut.dataUntilPos())
    } finally {
      dataOut_unlock()
    }
    if (this._protocol[command]._canBeRepliedTo) {
      return this._replyCallback(messageId, command, replyCallback)
    } else {
      return null
    }
  }
  
  async reply({replyTo, command, messageId, status = mandatory(), data, errorMessage}) {
    if (replyTo) {
      command = replyTo.command
      messageId = replyTo.id
    } else {
      command || mandatory('replyTo or command in reply()')
      messageId || mandatory('replyTo or messageId in reply()')
    }
    this._debug('reply:', command, status, data)
    if (data) {
      //if (!(status in this._protocol[command])) { // if there isn't a object template defined for this kind of reply
      if (!this._protocol[command][status]) {
        throw Error('No data template defined in the protocol for a "'+status+'" reply to the "'+command+'" command.')
      }
    } else {
      //if (status in this._protocol[command]) {
      if (this._protocol[command][status]) {
        throw Error('The template defined in the protocol for a "'+status+'" reply to the "'+command+'" command requires data to follow it.')
      }
    }
    const dataOut_unlock = await BNC._dataOut_mutex.lock()
    try {
      BNC._dataOut.start() // seek to start
      if (this._protocol._commandIdByteSize == 1) {
        BNC._dataOut.u8(this._protocol['_internal_reply']._commandId)
      } else {
        BNC._dataOut.u16(this._protocol['_internal_reply']._commandId)
      }
      BNC._dataOut.u16(messageId)
      let statusByte
      if (errorMessage) {
        statusByte = replyStatus.error
      } else {
        switch (status) {
          case 'success': statusByte = replyStatus.success; break
          case 'failure': statusByte = replyStatus.failure; break
          case 'error': statusByte = replyStatus.error; break
          default: throw Error('Unknown reply status: '+status+". It must be either 'success', 'failure' or 'error'.")
        }
      }
      BNC._dataOut.u8(statusByte)
      if (statusByte == replyStatus.error) {
        BNC._dataOut.writeString(errorMessage || 'Something went wrong...')
      } else if (data) {
        BNC._dataOut.writeObject(this._protocol[command][status], data)
      }
      //this._debug(BNC._dataOut.dataUntilPos())
      this._ws.send(BNC._dataOut.dataUntilPos())
    } finally {
      dataOut_unlock()
    }
  }

  close(code, reason) {
    this._ws.close(code, reason)
  }
  
  _requestSessionKey() {
    this.send('_internal_session_requestKey', null, reply => {
      if (reply.status == 'success') {
        this._mySessionKey = new Uint8Array(reply.sessionKey)
        this._callReadyCallbackIfReady()
        // if (typeof this._mySessionKeyCallback == 'function') {
        //   this._mySessionKeyCallback(this._mySessionKey)
        // }
      }
    })
  }
  
  _sendSessionKey() { // send a key and hope the peer recognizes you
    this.send('_internal_session_key', {
      sessionKey: this._mySessionKey
    }, reply => {
      if (reply.status == 'success') {
        this._callReadyCallbackIfReady()
      }
    })
  }
  
  _onClose(event) {
    if (typeof this._closedConnectionCallback == 'function' && this._sessionKey) {
      this._closedConnectionCallback({...event/*{code, reason}*/, sender: this, sessionKey: this._sessionKey})
    }
  }
  
  _onMessage(event) {
    try { // We catch any exceptions since the server shall not crash on malformed data
      const dataIn = new BetterDataView(event.data)
      const cmdId = this._protocol._commandIdByteSize == 1 ? dataIn.u8() : dataIn.u16()
      const command = this._protocol._commandArray[cmdId]
      let msgId
      if (this._protocol[command]._canBeRepliedTo || cmdId == this._protocol._internal_reply._commandId) {
        msgId = dataIn.u16()
      }
      
      switch (command) {
        case '_internal_reply': { // this ID is reserved for replies
          if (this._replyCallbacks.has(msgId)) {
            let replyStatus
            switch (dataIn.u8()) { // check reply status
              case 0: replyStatus = 'error'
                // const rwPos = dataIn.pos()
                // console.error('Server reported error:', dataIn.s())
                // dataIn.pos(rwPos)
              break
              case 1: replyStatus = 'success'; break
              case 2: replyStatus = 'failure'; break
            }
            let commandRepliedTo = this._replyCallbacks.get(msgId).command // the command replied to
            let data, error
            if (replyStatus == 'error') { // server reported error
              data = dataIn.s()//{message = dataIn.s()}
              console.warn('Server reported error:', data)//.message)
            //} else if (replyStatus in this._protocol[commandRepliedTo]) { // if there is a object template defined for this kind of reply
            } else if (this._protocol[commandRepliedTo][replyStatus]) {
              try {
                data = dataIn.readObject(this._protocol[commandRepliedTo][replyStatus]) // then use it
              } catch (e) { // if data is malformed it fails
                error = true
                console.warn(this._ipAddress,'Received malformed data in a "'+replyStatus+'" reply to the "'+command+'" command. Exception: '+e)
              }
            }
            if (!error) {
              this._debug('got reply:', commandRepliedTo, replyStatus, data)
              this._replyCallbacks.get(msgId).callback({status: replyStatus, data})
            }
          } else {
            console.warn(this._ipAddress,'Received a reply but was not expecting one, hence I don\'t know which command it was replying to.')
          }
        } break
        
        case '_internal_session_requestKey': { // peer wants a key generated for him
          this._sessionKey = new Uint8Array(8)
          this._getRandomValuesFunction(this._sessionKey)
          this._callReadyCallbackIfReady()
          this.reply({
            command: '_internal_session_requestKey', 
            messageId: msgId, 
            status: 'success', 
            data: {
              sessionKey: this._sessionKey
            }
          })
        } break
        
        case '_internal_session_key': { // peer already has a key he wants to use
          this._sessionKey = new Uint8Array(dataIn.readTypedArray(8))
          this._callReadyCallbackIfReady()
          this.reply({
            command: '_internal_session_key', 
            messageId: msgId, 
            status: 'success'
          })
        } break
        
        case undefined:
          console.warn(this._ipAddress,'Command with index '+cmdId.toString()+' was not found in the provided protocol.')
        break
        
        default: {// redirect to handler
          if (this._sessionKey) { // if the other end has a session key (if not then fuck him)
            let data, error
            if ('data' in this._protocol[command]) { // if there is a data template defined
              try { // try to read data into an object based on the template
                data = dataIn.readObject(this._protocol[command].data)
              } catch (e) { // if data is malformed it fails
                error = true
                console.warn(this._ipAddress,'Received malformed data bundled with the "'+command+'" command. Exception: '+e)
              }
            }
            if (!error) {
              this._debug('message:', command, data)
              this._commandCallback({sender: this, command, data, id: msgId})
            }
          } else {
            console.warn(this._ipAddress,'Received a command from someone without a session key, it was ignored.')
          }
        }
        
      }
    } catch(e) {
      console.warn(this._ipAddress,'Received malformed data or something else went wrong, exception: '+e)
    }
  }
}
// static variables (shared across all instances)
BNC._dataOut = new BetterDataView(new ArrayBuffer(1024)) // shared DataView and buffer for all outgoing packets
BNC._dataOut_mutex = new Mutex() // just make sure to use the mutex and we'll be fine
BNC._protocolCache = new Map()

export {BNC as BetterNetworkConnection}
/*
Todo:
Purge old reply callbacks (timed out replies)
  Using a timer called every 1 second (3 seconds = timed out or have option to set timeout)
Allow to set size of out-buffer or change it dynamicly?  
*/
