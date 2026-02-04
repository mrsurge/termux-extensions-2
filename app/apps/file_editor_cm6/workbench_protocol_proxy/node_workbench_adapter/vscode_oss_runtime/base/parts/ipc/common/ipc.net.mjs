import { Emitter, BufferedEmitter } from "../../../common/event.mjs";
import { VSBuffer } from "../../../common/buffer.mjs";
import { Disposable, DisposableStore } from "../../../common/lifecycle.mjs";

export const ProtocolMessageType = Object.freeze({
  None: 0,
  Regular: 1,
  Control: 2,
  Ack: 3,
  Disconnect: 5,
  ReplayRequest: 6,
  Pause: 7,
  Resume: 8,
  KeepAlive: 9,
});

export const ProtocolConstants = Object.freeze({
  HeaderLength: 13,
  AcknowledgeTime: 2000,
  TimeoutTime: 20000,
  ReconnectionGraceTime: 3 * 60 * 60 * 1000,
  ReconnectionShortGraceTime: 5 * 60 * 1000,
  KeepAliveSendTime: 5000,
});

function getEmptyBuffer() {
  return VSBuffer.alloc(0);
}

class ChunkStream {
  constructor() {
    this._chunks = [];
    this._totalLength = 0;
  }

  get byteLength() {
    return this._totalLength;
  }

  acceptChunk(data) {
    if (!data || data.byteLength === 0) return;
    this._chunks.push(data);
    this._totalLength += data.byteLength;
  }

  read(byteCount) {
    return this._read(byteCount, true);
  }

  peek(byteCount) {
    return this._read(byteCount, false);
  }

  _read(byteCount, advance) {
    if (byteCount === 0) return VSBuffer.alloc(0);
    if (this._chunks.length === 0) throw new Error("no chunks");
    if (this._chunks[0].byteLength === byteCount) {
      const result = this._chunks[0];
      if (advance) {
        this._chunks.shift();
        this._totalLength -= byteCount;
      }
      return result;
    }
    if (this._chunks[0].byteLength > byteCount) {
      const result = this._chunks[0].slice(0, byteCount);
      if (advance) {
        this._chunks[0] = this._chunks[0].slice(byteCount);
        this._totalLength -= byteCount;
      }
      return result;
    }
    const result = VSBuffer.alloc(byteCount);
    let resultOffset = 0;
    let chunkIndex = 0;
    let remaining = byteCount;
    while (remaining > 0) {
      const chunk = this._chunks[chunkIndex];
      if (chunk.byteLength > remaining) {
        const chunkPart = chunk.slice(0, remaining);
        result.set(chunkPart, resultOffset);
        resultOffset += remaining;
        if (advance) {
          this._chunks[chunkIndex] = chunk.slice(remaining);
          this._totalLength -= remaining;
        }
        remaining = 0;
      } else {
        result.set(chunk, resultOffset);
        resultOffset += chunk.byteLength;
        if (advance) {
          this._chunks.shift();
          this._totalLength -= chunk.byteLength;
        } else {
          chunkIndex++;
        }
        remaining -= chunk.byteLength;
      }
    }
    return result;
  }
}

class ProtocolMessage {
  constructor(type, id, ack, data) {
    this.type = type;
    this.id = id >>> 0;
    this.ack = ack >>> 0;
    this.data = data;
    this.writtenTime = 0;
  }
}

class ProtocolReader extends Disposable {
  constructor(socket) {
    super();
    this._socket = socket;
    this._incomingData = new ChunkStream();
    this.lastReadTime = Date.now();
    this._onMessage = this._register(new Emitter());
    this.onMessage = this._onMessage.event;
    this._state = { readHead: true, readLen: ProtocolConstants.HeaderLength, messageType: ProtocolMessageType.None, id: 0, ack: 0 };
    this._register(this._socket.onData((data) => this.acceptChunk(data)));
  }

  acceptChunk(data) {
    if (!data || data.byteLength === 0) return;
    this.lastReadTime = Date.now();
    this._incomingData.acceptChunk(data);
    while (this._incomingData.byteLength >= this._state.readLen) {
      const buff = this._incomingData.read(this._state.readLen);
      if (this._state.readHead) {
        this._state.readHead = false;
        this._state.readLen = buff.readUInt32BE(9);
        this._state.messageType = buff.readUInt8(0);
        this._state.id = buff.readUInt32BE(1);
        this._state.ack = buff.readUInt32BE(5);
      } else {
        const messageType = this._state.messageType;
        const id = this._state.id;
        const ack = this._state.ack;
        this._state.readHead = true;
        this._state.readLen = ProtocolConstants.HeaderLength;
        this._state.messageType = ProtocolMessageType.None;
        this._state.id = 0;
        this._state.ack = 0;
        this._onMessage.fire(new ProtocolMessage(messageType, id, ack, buff));
      }
    }
  }

  readEntireBuffer() {
    return this._incomingData.read(this._incomingData.byteLength);
  }
}

class ProtocolWriter {
  constructor(socket) {
    this._socket = socket;
    this._data = [];
    this._totalLength = 0;
    this._isPaused = false;
    this._writeNowTimeout = null;
    this.lastWriteTime = 0;
  }

  pause() {
    this._isPaused = true;
  }

  resume() {
    this._isPaused = false;
    this._scheduleWriting();
  }

  drain() {
    this.flush();
    return this._socket.drain();
  }

  flush() {
    this._writeNow();
  }

  write(msg) {
    msg.writtenTime = Date.now();
    this.lastWriteTime = Date.now();
    const header = VSBuffer.alloc(ProtocolConstants.HeaderLength);
    header.writeUInt8(msg.type, 0);
    header.writeUInt32BE(msg.id, 1);
    header.writeUInt32BE(msg.ack, 5);
    header.writeUInt32BE(msg.data.byteLength, 9);
    this._writeSoon(header, msg.data);
  }

  _bufferAdd(head, body) {
    const wasEmpty = this._totalLength === 0;
    this._data.push(head, body);
    this._totalLength += head.byteLength + body.byteLength;
    return wasEmpty;
  }

  _bufferTake() {
    const ret = VSBuffer.concat(this._data, this._totalLength);
    this._data.length = 0;
    this._totalLength = 0;
    return ret;
  }

  _writeSoon(header, data) {
    if (this._bufferAdd(header, data)) this._scheduleWriting();
  }

  _scheduleWriting() {
    if (this._writeNowTimeout) return;
    this._writeNowTimeout = setTimeout(() => {
      this._writeNowTimeout = null;
      this._writeNow();
    }, 0);
  }

  _writeNow() {
    if (this._totalLength === 0) return;
    if (this._isPaused) return;
    const data = this._bufferTake();
    this._socket.write(data);
  }
}

export class PersistentProtocol {
  constructor(opts) {
    this._isReconnecting = false;
    this._outgoingUnackMsg = [];
    this._outgoingMsgId = 0;
    this._outgoingAckId = 0;
    this._outgoingAckTimeout = null;
    this._incomingMsgId = 0;
    this._incomingAckId = 0;
    this._incomingMsgLastTime = 0;
    this._incomingAckTimeout = null;
    this._lastReplayRequestTime = 0;
    this._lastSocketTimeoutTime = Date.now();

    this._onControlMessage = new BufferedEmitter();
    this.onControlMessage = this._onControlMessage.event;
    this._onMessage = new BufferedEmitter();
    this.onMessage = this._onMessage.event;
    this._onDidDispose = new BufferedEmitter();
    this.onDidDispose = this._onDidDispose.event;
    this._onSocketClose = new BufferedEmitter();
    this.onSocketClose = this._onSocketClose.event;
    this._onSocketTimeout = new BufferedEmitter();
    this.onSocketTimeout = this._onSocketTimeout.event;

    this._socketDisposables = new DisposableStore();
    this._socket = opts.socket;
    this._socketWriter = this._socketDisposables.add(new ProtocolWriter(this._socket));
    this._socketReader = this._socketDisposables.add(new ProtocolReader(this._socket));
    this._socketDisposables.add(this._socketReader.onMessage((msg) => this._receiveMessage(msg)));
    this._socketDisposables.add(this._socket.onClose((e) => this._onSocketClose.fire(e)));
    if (opts.initialChunk) this._socketReader.acceptChunk(opts.initialChunk);
    this._keepAliveInterval = opts.sendKeepAlive === false ? null : setInterval(() => this._sendKeepAlive(), ProtocolConstants.KeepAliveSendTime);
  }

  dispose() {
    if (this._outgoingAckTimeout) clearTimeout(this._outgoingAckTimeout);
    if (this._incomingAckTimeout) clearTimeout(this._incomingAckTimeout);
    if (this._keepAliveInterval) clearInterval(this._keepAliveInterval);
    this._socketDisposables.dispose();
  }

  drain() {
    return this._socketWriter.drain();
  }

  sendControl(buffer) {
    const msg = new ProtocolMessage(ProtocolMessageType.Control, 0, 0, buffer);
    this._socketWriter.write(msg);
  }

  send(buffer) {
    const myId = ++this._outgoingMsgId;
    this._incomingAckId = this._incomingMsgId;
    const msg = new ProtocolMessage(ProtocolMessageType.Regular, myId, this._incomingAckId, buffer);
    this._outgoingUnackMsg.push(msg);
    if (!this._isReconnecting) {
      this._socketWriter.write(msg);
      this._recvAckCheck();
    }
  }

  getMillisSinceLastIncomingData() {
    return Date.now() - this._socketReader.lastReadTime;
  }

  _receiveMessage(msg) {
    if (msg.ack > this._outgoingAckId) {
      this._outgoingAckId = msg.ack;
      while (true) {
        const first = this._outgoingUnackMsg[0];
        if (first && first.id <= msg.ack) this._outgoingUnackMsg.shift();
        else break;
      }
    }
    switch (msg.type) {
      case ProtocolMessageType.Regular: {
        if (msg.id > this._incomingMsgId) {
          if (msg.id !== this._incomingMsgId + 1) {
            const now = Date.now();
            if (now - this._lastReplayRequestTime > 10000) {
              this._lastReplayRequestTime = now;
              this._socketWriter.write(new ProtocolMessage(ProtocolMessageType.ReplayRequest, 0, 0, getEmptyBuffer()));
            }
          } else {
            this._incomingMsgId = msg.id;
            this._incomingMsgLastTime = Date.now();
            this._sendAckCheck();
            this._onMessage.fire(msg.data);
          }
        }
        break;
      }
      case ProtocolMessageType.Control:
        this._onControlMessage.fire(msg.data);
        break;
      case ProtocolMessageType.Disconnect:
        this._onDidDispose.fire();
        break;
      case ProtocolMessageType.ReplayRequest:
        for (const m of this._outgoingUnackMsg) this._socketWriter.write(m);
        this._recvAckCheck();
        break;
      case ProtocolMessageType.Pause:
        this._socketWriter.pause();
        break;
      case ProtocolMessageType.Resume:
        this._socketWriter.resume();
        break;
      case ProtocolMessageType.KeepAlive:
      case ProtocolMessageType.Ack:
      case ProtocolMessageType.None:
      default:
        break;
    }
  }

  _sendAckCheck() {
    if (this._incomingMsgId <= this._incomingAckId) return;
    if (this._incomingAckTimeout) return;
    const timeSinceLastIncomingMsg = Date.now() - this._incomingMsgLastTime;
    if (timeSinceLastIncomingMsg >= ProtocolConstants.AcknowledgeTime) {
      this._sendAck();
      return;
    }
    this._incomingAckTimeout = setTimeout(() => {
      this._incomingAckTimeout = null;
      this._sendAckCheck();
    }, ProtocolConstants.AcknowledgeTime - timeSinceLastIncomingMsg + 5);
  }

  _sendAck() {
    this._incomingAckId = this._incomingMsgId;
    const msg = new ProtocolMessage(ProtocolMessageType.Ack, 0, this._incomingAckId, getEmptyBuffer());
    this._socketWriter.write(msg);
  }

  _recvAckCheck() {
    if (this._outgoingMsgId <= this._outgoingAckId) return;
    if (this._outgoingAckTimeout) return;
    if (this._isReconnecting) return;
    const oldest = this._outgoingUnackMsg[0];
    if (!oldest) return;
    const timeSinceOldest = Date.now() - oldest.writtenTime;
    const timeSinceLastReceived = Date.now() - this._socketReader.lastReadTime;
    const timeSinceLastTimeout = Date.now() - this._lastSocketTimeoutTime;
    if (timeSinceOldest >= ProtocolConstants.TimeoutTime && timeSinceLastReceived >= ProtocolConstants.TimeoutTime && timeSinceLastTimeout >= ProtocolConstants.TimeoutTime) {
      this._lastSocketTimeoutTime = Date.now();
      this._onSocketTimeout.fire({ type: "timeout" });
      return;
    }
    const timeUntilTimeout = Math.min(
      ProtocolConstants.TimeoutTime - timeSinceOldest,
      ProtocolConstants.TimeoutTime - timeSinceLastReceived,
      ProtocolConstants.TimeoutTime - timeSinceLastTimeout
    );
    this._outgoingAckTimeout = setTimeout(() => {
      this._outgoingAckTimeout = null;
      this._recvAckCheck();
    }, Math.max(5, timeUntilTimeout));
  }

  _sendKeepAlive() {
    this._incomingAckId = this._incomingMsgId;
    const msg = new ProtocolMessage(ProtocolMessageType.KeepAlive, 0, this._incomingAckId, getEmptyBuffer());
    this._socketWriter.write(msg);
  }
}
