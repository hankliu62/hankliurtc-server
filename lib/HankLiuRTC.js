const WebSocketServer = require('ws').Server;
const events = require('events');
const util = require('util');
const UUID = require('uuid');

const AvatarPath = {
  'bishengke': 'https://user-images.githubusercontent.com/8088864/54666706-82b0aa80-4b25-11e9-95f0-7030fcff9959.jpg',
  'cmb': 'https://user-images.githubusercontent.com/8088864/54667263-e12a5880-4b26-11e9-836e-bdb672062f8f.jpg',
  'didi': 'https://user-images.githubusercontent.com/8088864/54667307-f901dc80-4b26-11e9-887f-ad767b10cbe6.jpg',
  'JD': 'https://user-images.githubusercontent.com/8088864/54667341-0e770680-4b27-11e9-9e58-dcbc477b1adf.jpg',
  'luckin': 'https://user-images.githubusercontent.com/8088864/54667419-4120ff00-4b27-11e9-896b-59995fbccefc.jpg',
  'meituan': 'https://user-images.githubusercontent.com/8088864/54667437-4ed68480-4b27-11e9-8a45-3b2f1fdc7e74.jpg',
  'tx-kcard': 'https://user-images.githubusercontent.com/8088864/54667461-601f9100-4b27-11e9-805a-1548ac0b816f.jpg',
  'wechat': 'https://user-images.githubusercontent.com/8088864/54667493-7299ca80-4b27-11e9-9648-2797d0116c1e.jpg'
}

const Avatars = Object.keys(AvatarPath);
let LeaveAvatars = Avatars.map(function(avatar) {
  return avatar;
})

// LxYuuRTC构造函数
function LxYuuRTC() {
  // 连接到服务器所有的 client 的 socket
  this.sockets = [];
  // 根据不同房间对连入服务器中的所有的 client 对应的 socket 进行分类
  // { [roomName]: [sockets...] }
  this.rooms = {};

  // 存在新的socket客户端连入进来
  this.on('join', function(data, curSocket) {
    // 获得目前所有的 socket 的 uuid
    const socketIds = [];
    // 获得目前所有的 socket 的对应客户端的 avatar
    const socketAvatars = [];

    // 接入的房间
    const room = data.room || 'default';
    curSocket.room = room;
    const roomSockets = this.rooms[room] || [];
    for (const socket of roomSockets) {
      if (socket.id === curSocket.id) {
        continue;
      }

      socketIds.push(socket.id);
      socketAvatars.push(socket.avatar);
      // 针对每一个已经连入的房间的 client, 通过 socket 发送一条 new_peer 的 message
      socket.send(JSON.stringify({
        eventName: 'new_peer',
        data: {
          socketId: curSocket.id,
          socketAvatar: curSocket.avatar
        }
      }), this.onerror);
    }

    roomSockets.push(curSocket);
    this.rooms[room] = roomSockets;

    // 给自身 client 的 socket 发送一条 peers 的 message,
    // 传递当前房间中存在的所有其他的 client socket 的 uuid 以及自身的 socket uuid
    curSocket.send(JSON.stringify({
      eventName: 'peers',
      data: {
        connections: socketIds,
        avatars: socketAvatars,
        me: curSocket.id,
        myselfAvatar: curSocket.avatar
      }
    }), this.onerror);

    // EventEmitter 事件
    this.emit('_new_peer', curSocket, room);
  });

  // 收到本地的ice candidate, 进行中转到指定的socket客户端
  this.on('ice_candidate', function(data, curSocket) {
    const targetSocket = this.findSocket(data.socketId);

    if (targetSocket) {
      targetSocket.send(JSON.stringify({
        eventName: 'ice_candidate',
        data: {
          label: data.label,
          candidate: data.candidate,
          socketId: curSocket.id
        }
      }), this.onerror);
    }

    // EventEmitter 事件
    this.emit('_ice_candidate', curSocket, data);
  });

  // 收到本地的SDP offer，进行中转到指定的socket客户端
  this.on('offer', function(data, curSocket) {
    const targetSocket = this.findSocket(data.socketId);

    if (targetSocket) {
      targetSocket.send(JSON.stringify({
        eventName: 'offer',
        data: {
          sdp: data.sdp,
          socketId: curSocket.id
        }
      }), this.onerror);
    }

    // EventEmitter 事件
    this.emit('_offer', curSocket, data);
  });

  // 收到本地的SDP answer，进行中转到指定的socket客户端
  this.on('answer', function(data, curSocket) {
    const targetSocket = this.findSocket(data.socketId);

    if (targetSocket) {
      targetSocket.send(JSON.stringify({
        eventName: 'answer',
        data: {
          sdp: data.sdp,
          socketId: curSocket.id
        }
      }), this.onerror);
    }

    // EventEmitter 事件
    this.emit('_answer', curSocket, data);
  });
}

// 继承 EventEmitter 对象
util.inherits(LxYuuRTC, events.EventEmitter);

// 当存在客户端连接时，进行初始化初始化
LxYuuRTC.prototype.init = function(socket) {
  socket.id = UUID.v4();
  if (LeaveAvatars.length === 0) {
    LeaveAvatars = Avatars.map(function(avatar) {
      return avatar;
    });
  }
  const avatarIndex = Math.floor(Math.random() * LeaveAvatars.length);
  socket.avatar = AvatarPath[LeaveAvatars.splice(avatarIndex, 1)[0]] || '';
  this.addSocket(socket);

  // 为新连入的 client 的 socket 添加监听事件
  // 监听 'message' 事件
  socket.on('message', function(message) {
    const data = JSON.parse(message);
    if (data.eventName) {
      this.emit(data.eventName, data.data, socket);
    } else {
      this.emit('_socket_message', message, socket);
    }
  }.bind(this));

  // 监听 'close' 事件
  socket.on('close', function() {
    if (socket.room && this.rooms[socket.room]) {
      for (const joinedSocket of this.rooms[socket.room]) {
        if (joinedSocket.id === socket.id) {
          continue;
        }

        joinedSocket.send(JSON.stringify({
          eventName: 'remove_peer',
          data: {
            socketId: socket.id
          }
        }), this.onerror);
      }
    }

    this.removeSocket(socket);

    // EventEmitter 事件
    this.emit('_remove_peer', socket, this);
  }.bind(this));

  // EventEmitter 事件
  this.emit('_new_connect', socket);
};

// 添加 socket 到已经连接服务器 sockets 缓存中
LxYuuRTC.prototype.addSocket = function(socket) {
  this.sockets.push(socket);
};

// 从已经连接服务器 sockets 缓存中移除 socket, 同时从根据 room 分类的缓存中移除
LxYuuRTC.prototype.removeSocket = function(socket) {
  const index = this.sockets.findIndex(function(item) {
    return item === socket;
  });

  if (index > -1) {
    this.sockets.splice(index, 1);
  }

  if (socket.room && this.rooms[socket.room]) {
    const roomIndex = this.rooms[socket.room].findIndex(function(item) {
      return item === socket;
    });

    if (roomIndex > -1) {
      this.rooms[socket.room].splice(roomIndex, 1);
    }
  }
};

// 根据socket uuid 获取指定的socket
LxYuuRTC.prototype.findSocket = function(socketId) {
  for (const socket of this.sockets) {
    if (socket.id === socketId) {
      return socket;
    }
  }

  return undefined;
};

// 触发错误
LxYuuRTC.prototype.onerror = function(error) {
  if (error) {
    this.emit('_error', error);
  }
};

module.exports.listen = function(server) {
  let LxYuuRTCServer;
  if (typeof server === 'number') {
    LxYuuRTCServer = new WebSocketServer({
      port: server
    });
  } else {
    LxYuuRTCServer = new WebSocketServer({
      server
    });
  }

  LxYuuRTCServer.rtc = new LxYuuRTC();
  LxYuuRTCServer.on('connection', function(socket) {
    this.rtc.init(socket);
  });

  return LxYuuRTCServer;
};
