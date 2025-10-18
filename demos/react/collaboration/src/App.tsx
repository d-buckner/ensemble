import { useActor } from '@d-buckner/ensemble-react';
import { useState, useEffect } from 'react';
import { WebSocketToken, PeerMessagingToken, TodosToken } from './tokens';
import './App.css';


const DEFAULT_SERVER_URL = 'http://localhost:3001';
const DEFAULT_ROOM_ID = 'demo-room';

export function App() {
  const websocket = useActor(WebSocketToken);
  const peerMessaging = useActor(PeerMessagingToken);
  const todos = useActor(TodosToken);

  const [newTodoText, setNewTodoText] = useState('');

  // Auto-connect on mount
  useEffect(() => {
    // Only connect if not already connecting/connected
    if (websocket.state.connectionState === 'disconnected') {
      websocket.actions.connect();
    }
  }, []);

  const handleDisconnect = () => {
    websocket.actions.disconnect();
  };

  const handleReconnect = () => {
    websocket.actions.connect();
  };

  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTodoText.trim()) {
      todos.actions.addTodo(newTodoText.trim());
      setNewTodoText('');
    }
  };

  const connectionState = websocket.state.connectionState;
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const isDisconnected = connectionState === 'disconnected';
  const connectedPeers = peerMessaging.state.connectedPeers || [];
  const peerTransports = peerMessaging.state.peerTransports || {};

  // Show loading screen while connecting
  if (isConnecting) {
    return (
      <div className="app">
        <header>
          <h1>🤝 Ensemble Collaboration Demo</h1>
          <p>Real-time collaborative todos with CRDTs</p>
        </header>

        <div className="loading-screen">
          <div className="spinner"></div>
          <h2>Connecting to server...</h2>
          <p className="loading-details">
            Connecting to <strong>{DEFAULT_SERVER_URL}</strong>
            <br />
            Room: <strong>{DEFAULT_ROOM_ID}</strong>
          </p>
          <div className="help-text">
            <p>💡 <strong>Make sure the server is running:</strong></p>
            <code>cd packages/collaboration && npm run demo:server</code>
          </div>
        </div>
      </div>
    );
  }

  // Show error screen if disconnected (after failed connection)
  if (isDisconnected && websocket.state.peerId === null) {
    return (
      <div className="app">
        <header>
          <h1>🤝 Ensemble Collaboration Demo</h1>
          <p>Real-time collaborative todos with CRDTs</p>
        </header>

        <div className="error-screen">
          <div className="error-icon">⚠️</div>
          <h2>Unable to connect to server</h2>
          <p className="error-details">
            Could not connect to <strong>{DEFAULT_SERVER_URL}</strong>
          </p>
          <button onClick={handleReconnect} className="reconnect-btn">
            Try Again
          </button>
          <div className="help-text">
            <p>💡 <strong>Make sure the server is running:</strong></p>
            <code>cd packages/collaboration && npm run demo:server</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>🤝 Ensemble Collaboration Demo</h1>
        <div className="connection-status">
          <span className="status-indicator connected">
            🟢 Connected
          </span>
          <span className="room-info">Room: {DEFAULT_ROOM_ID}</span>
          <span className="peers-info">
            👥 {connectedPeers.length} peer{connectedPeers.length !== 1 ? 's' : ''}
          </span>
          <button onClick={handleDisconnect} className="disconnect-btn">
            Disconnect
          </button>
        </div>

        {/* Compact Transport Status */}
        {connectedPeers.length > 0 && (
          <div className="transport-status">
            {connectedPeers.map((peerId) => {
              const transport = peerTransports[peerId] || 'websocket';
              const isWebRTC = transport === 'webrtc';

              return (
                <span key={peerId} className={`transport-chip ${transport}`} title={`Peer ${peerId.substring(0, 8)}`}>
                  <span className="transport-icon">{isWebRTC ? '⚡' : '🌐'}</span>
                  <span className="transport-label">{isWebRTC ? 'WebRTC' : 'WebSocket'}</span>
                </span>
              );
            })}
          </div>
        )}
      </header>

      <main>
        <div className="todo-section">
          <h2>Collaborative Todos</h2>
          <p className="subtitle">
            Open this page in multiple tabs or browsers to see real-time collaboration!
          </p>

          <form onSubmit={handleAddTodo} className="add-todo-form">
            <input
              type="text"
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              placeholder="What needs to be done?"
              className="todo-input"
            />
            <button type="submit" className="add-btn">
              Add Todo
            </button>
          </form>

          <div className="todo-list">
            {todos.state.todos.length === 0 ? (
              <p className="empty-state">No todos yet. Add one above!</p>
            ) : (
              todos.state.todos.map((todo) => (
                <div key={todo.id} className="todo-item">
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={() => todos.actions.toggleTodo(todo.id)}
                    className="todo-checkbox"
                  />
                  <span className={`todo-text ${todo.done ? 'done' : ''}`}>
                    {todo.text}
                  </span>
                  <button
                    onClick={() => todos.actions.removeTodo(todo.id)}
                    className="remove-btn"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="stats">
            <span>{todos.state.todos.filter(t => !t.done).length} active</span>
            <span>{todos.state.todos.filter(t => t.done).length} completed</span>
            <span>{todos.state.todos.length} total</span>
          </div>
        </div>
      </main>
    </div>
  );
}
