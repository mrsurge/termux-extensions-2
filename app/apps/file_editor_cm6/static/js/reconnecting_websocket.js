// app/apps/file_editor_cm6/static/js/reconnecting_websocket.js

/**
 * ReconnectingWebSocket - Auto-reconnecting WebSocket wrapper
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Configurable retry attempts and delays
 * - Event handlers: onopen, onmessage, onerror, onclose
 * - send() queues messages when disconnected
 * - Manual close() stops reconnection attempts
 * 
 * Usage:
 *   const ws = new ReconnectingWebSocket('ws://localhost:8080/ws/endpoint', {
 *     maxRetries: 10,
 *     reconnectInterval: 1000,
 *     maxReconnectInterval: 30000,
 *     reconnectDecay: 1.5,
 *     debug: true
 *   });
 *   
 *   ws.onopen = () => console.log('Connected');
 *   ws.onmessage = (event) => console.log('Message:', event.data);
 *   ws.onerror = (error) => console.error('Error:', error);
 *   ws.onclose = (event) => console.log('Closed:', event);
 *   
 *   ws.send('Hello server');
 *   ws.close(); // Stop reconnecting
 */

export class ReconnectingWebSocket {
  constructor(url, options = {}) {
    this.url = url;
    this.options = {
      maxRetries: options.maxRetries ?? Infinity,
      reconnectInterval: options.reconnectInterval ?? 1000, // Start at 1 second
      maxReconnectInterval: options.maxReconnectInterval ?? 30000, // Cap at 30 seconds
      reconnectDecay: options.reconnectDecay ?? 1.5, // Exponential backoff multiplier
      debug: options.debug ?? false,
      protocols: options.protocols ?? [],
    };
    
    this.ws = null;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.messageQueue = [];
    this.forcedClose = false;
    this.readyState = WebSocket.CONNECTING;
    
    // Event handlers (set by user)
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.onreconnect = null; // Called before each reconnection attempt
    
    this._connect();
  }
  
  _log(...args) {
    if (this.options.debug) {
      console.log('[ReconnectingWebSocket]', ...args);
    }
  }
  
  _connect() {
    if (this.forcedClose) {
      this._log('Connection blocked: forcedClose = true');
      return;
    }
    
    this._log(`Connecting to ${this.url}...`);
    
    try {
      this.ws = new WebSocket(this.url, this.options.protocols);
      this.readyState = WebSocket.CONNECTING;
      
      this.ws.onopen = (event) => {
        this._log('Connected successfully');
        this.readyState = WebSocket.OPEN;
        this.reconnectAttempts = 0;
        
        // Flush queued messages
        while (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift();
          this._log('Sending queued message:', message);
          this.ws.send(message);
        }
        
        if (this.onopen) {
          this.onopen(event);
        }
      };
      
      this.ws.onmessage = (event) => {
        if (this.onmessage) {
          this.onmessage(event);
        }
      };
      
      this.ws.onerror = (error) => {
        this._log('WebSocket error:', error);
        if (this.onerror) {
          this.onerror(error);
        }
      };
      
      this.ws.onclose = (event) => {
        this._log('Connection closed:', event.code, event.reason);
        this.readyState = WebSocket.CLOSED;
        
        if (this.onclose) {
          this.onclose(event);
        }
        
        // Attempt reconnection if not manually closed
        if (!this.forcedClose) {
          this._scheduleReconnect();
        }
      };
      
    } catch (error) {
      this._log('Connection error:', error);
      this.readyState = WebSocket.CLOSED;
      
      if (this.onerror) {
        this.onerror(error);
      }
      
      if (!this.forcedClose) {
        this._scheduleReconnect();
      }
    }
  }
  
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.options.maxRetries) {
      this._log(`Max reconnection attempts (${this.options.maxRetries}) reached`);
      return;
    }
    
    this.reconnectAttempts++;
    
    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(this.options.reconnectDecay, this.reconnectAttempts - 1),
      this.options.maxReconnectInterval
    );
    
    this._log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.options.maxRetries})...`);
    
    if (this.onreconnect) {
      this.onreconnect(this.reconnectAttempts, delay);
    }
    
    this.reconnectTimeout = setTimeout(() => {
      this._connect();
    }, delay);
  }
  
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._log('Sending message:', data);
      this.ws.send(data);
    } else {
      this._log('Queueing message (not connected):', data);
      this.messageQueue.push(data);
    }
  }
  
  close(code = 1000, reason = 'Normal closure') {
    this._log('Manually closing connection');
    this.forcedClose = true;
    
    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close(code, reason);
    }
    
    this.readyState = WebSocket.CLOSED;
  }
  
  reconnect() {
    this._log('Manual reconnect requested');
    this.forcedClose = false;
    this.reconnectAttempts = 0;
    
    if (this.ws) {
      this.ws.close();
    }
    
    this._connect();
  }
  
  // Getters for compatibility with native WebSocket
  get bufferedAmount() {
    return this.ws ? this.ws.bufferedAmount : 0;
  }
  
  get extensions() {
    return this.ws ? this.ws.extensions : '';
  }
  
  get protocol() {
    return this.ws ? this.ws.protocol : '';
  }
  
  get binaryType() {
    return this.ws ? this.ws.binaryType : 'blob';
  }
  
  set binaryType(type) {
    if (this.ws) {
      this.ws.binaryType = type;
    }
  }
}

// Default export
export default ReconnectingWebSocket;
