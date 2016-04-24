import AppDispatcher from '../dispatcher/AppDispatcher';
import RobotActions from '../actions/RobotActions';
import fs from 'fs';
import request from 'superagent';
import { remote, ipcRenderer } from 'electron';
const storage = remote.require('electron-json-storage');

let defaultAddress = '192.168.13.100';
let socket = null;
let mode = null;

function connectToAnsible(runtimeAddress) {
  // Remove the existing connection.
  if (socket !== null) {
    socket.disconnect();
  }

  socket = io(
    'http://' + runtimeAddress + ':5000/',
    {transports: ['websocket']}
  );

  socket.on('connect', ()=>{
    RobotActions.updateConnection(true);
    ipcRenderer.send('runtime-connect');
    console.log('Connected to runtime.');
  });

  socket.on('disconnect', ()=>{
    RobotActions.updateConnection(false);
    ipcRenderer.send('runtime-disconnect');
    console.log('Disconnected from runtime');
  });

  socket.on('connect_error', (err)=>console.log(err));

  /*
   * Hack for Ansible messages to enter Flux flow.
   * Received messages are dispatched as actions,
   * with action's type deteremined by msg_type
   */
  socket.on('message', (message)=>{
    let transportName = socket.io.engine.transport.name;
    if (transportName !== mode) {
      mode = transportName
      console.log('SocketIO is using ', mode);
    }
    let unpackedMsg = message.content;
    unpackedMsg.type = message.header.msg_type;
    AppDispatcher.dispatch(unpackedMsg);
  });

  Ansible.runtimeAddress = runtimeAddress;
}

function initAnsible() {
  storage.has('runtimeAddress').then((hasKey)=>{
    if (hasKey) {
      storage.get('runtimeAddress').then((data)=>{
        connectToAnsible(data.address);
      });
    } else {
      connectToAnsible(defaultAddress);
      storage.set('runtimeAddress', {
        address: defaultAddress
      }, (err)=>{
        if(err) throw err;
      });
    }
  });
}



/*
 * Module for communicating with the runtime.
 */
let Ansible = {
  reload() {
    initAnsible();
  },
  /* Private, use sendMessage */
  _send(obj, callback) {
    if (socket !== null) {
      return socket.emit('message', JSON.stringify(obj), (response)=>{
        if(callback) {
          callback(response);
        }
      });
    } else {
      console.log('Socket is not initialized!');
    }
  },
  /* Send data over SocketIO to the runtime */
  sendMessage(msgType, content, callback) {
    let msg = {
      header: {
        msg_type: msgType
      },
      content: content
    };
    this._send(msg, callback);
  },
  uploadFile(filepath, callback) {
    if (this.runtimeAddress) {
      request
        .post('http://' + this.runtimeAddress + ':5000/upload')
        .attach('file', filepath).end(callback);
    } else {
      console.log('Cannot upload! Not connected to runtime!');
    }
  }
};

initAnsible();
export default Ansible;
