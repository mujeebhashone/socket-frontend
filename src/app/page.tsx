"use client";
import { useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  text: string;
  room: string;
  delivered?: boolean;
  seq?: number; // Add sequence number from backend
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [input, setInput] = useState("");
  const [username, setUsername] = useState("");
  const [registered, setRegistered] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const pendingQueue = useRef<Map<string, Message>>(new Map());
  const [typingUser, setTypingUser] = useState<string | null>(null);

  const genId = () => Math.random().toString(36).substring(2, 9);

  const connect = () => {
    const ws = new WebSocket("ws://localhost:3001");
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("✅ Connected to WebSocket");
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);

      // Rejoin room if previously joined
      if (joined && room) send("joinRoom", { room });

      // resend any undelivered messages
      resendPending();
    };

    ws.onmessage = (event) => {
      try {
        const { event: evt, data } = JSON.parse(event.data);

        switch (evt) {
       

          case "joined":
            setJoined(true);
            addMsg({
              id: genId(),
              text: data.message,
              room,
              delivered: true,
            });
            break;

          case "chatRoom":
            // Update existing message with sequence number instead of adding new one
            setMessages((msgs) =>
              msgs.map((m) =>
                m.id === data.id
                  ? { ...m, seq: data.seq, delivered: true }
                  : m
              )
            );
            break;

          case "ack":
            markDelivered(data.id, data.seq); // Pass sequence from ack
            break;

          case "userOnline":
            setOnlineUsers(prev => [...prev, data.username]);
            break;

          case "userOffline":
            setOnlineUsers(prev => prev.filter(user => user !== data.username));
            break;

          case "onlineUsers":
            setOnlineUsers(data);
            break;

          case "userTyping":
            console.log(`✍️ Frontend: Received typing event:`, { username: data.username, typing: data.typing });
            if (data.typing) {
              setTypingUser(data.username);
              console.log(`✍️ Frontend: Set typing user to: ${data.username}`);
            } else {
              setTypingUser(null);
              console.log(`✍️ Frontend: Cleared typing user`);
            }
            break;

          default:
            console.warn("⚠️ Unknown event:", evt);
        }
      } catch (err) {
        console.error("❌ Invalid message format:", err);
      }
    };

    ws.onclose = () => {
      console.warn("⚠️ Disconnected, retrying...");
      reconnect();
    };

    ws.onerror = (err) => {
      console.error("❌ WebSocket error:", err);
      ws.close();
    };
  };

  const reconnect = () => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => {
      console.log("🔁 Trying to reconnect...");
      connect();
    }, 3000);
  };

  const addMsg = (msg: Message) => {
    setMessages((m) => {
      // Check if message already exists to prevent duplicates
      const exists = m.some(existing => existing.id === msg.id);
      if (exists) return m;
      return [...m, msg];
    });
  };

  const markDelivered = (id: string, seq?: number) => {
    setMessages((msgs) =>
      msgs.map((m) => 
        m.id === id ? { ...m, delivered: true, seq: seq || m.seq } : m
      )
    );
    pendingQueue.current.delete(id);
  };

  const send = (event: string, data: any) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event, data }));
    }
  };

  const resendPending = () => {
    pendingQueue.current.forEach((msg) => {
      console.log("🔁 Resending pending:", msg.text);
      send("chatRoom", msg);
    });
  };

  const registerUser = () => {
    if (username.trim()) {
      send("registerUser", { username: username.trim() });
      setRegistered(true);
    }
  };

  const joinRoom = () => {
    if (room.trim()) send("joinRoom", { room });
  };

  const sendMessage = () => {
    if (!input.trim() || !joined || !registered) return;

    const msg: Message = {
      id: genId(),
      text: input,
      room,
      delivered: false, // Mark as undelivered
    };

    // Show message immediately with pending indicator
    addMsg(msg);
    pendingQueue.current.set(msg.id, msg);
    send("chatRoom", msg);

    // Stop typing indicator
    console.log(`✍️ Frontend: Stopping typing indicator for ${username}`);
    send("userTyping", { username, typing: false });

    // Retry if no ack after 5s
    setTimeout(() => {
      if (pendingQueue.current.has(msg.id)) {
        console.log("⏳ Retrying message:", msg.text);
        send("chatRoom", msg);
      }
    }, 5000);

    setInput("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    
    // Send typing indicator
    if (joined && registered && e.target.value.trim()) {
      console.log(`✍️ Frontend: Sending typing=true for ${username}`);
      send("userTyping", { username, typing: true });
    } else {
      console.log(`✍️ Frontend: Sending typing=false for ${username}`);
      send("userTyping", { username, typing: false });
    }
  };

  useEffect(() => {
    connect();
    return () => socketRef.current?.close();
  }, []);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-4">💬 Reliable Chat (Ack + Retry)</h1>

      {!registered ? (
        <div className="flex gap-2 mb-4">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your username"
            className="border p-2 flex-1"
          />
          <button
            onClick={registerUser}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            Register
          </button>
        </div>
      ) : !joined ? (
        <div className="flex gap-2 mb-4">
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="Enter room name"
            className="border p-2 flex-1"
          />
          <button
            onClick={joinRoom}
            className="bg-green-600 text-white px-4 py-2 rounded"
          >
            Join
          </button>
        </div>
      ) : (
        <div className="mb-4">
          <p>✅ Joined room: <b>{room}</b> as <b>{username}</b></p>
          {onlineUsers.length > 0 && (
            <p className="text-sm text-gray-600 mt-1">
              Online: {onlineUsers.join(", ")}
            </p>
          )}
          {typingUser && (
            <p className="text-sm text-blue-500 mt-1">
              ✍️ {typingUser} is typing...
            </p>
          )}
        </div>
      )}

      <div className="border p-4 h-64 overflow-y-auto mb-4">
        {messages
          .sort((a, b) => (a.seq || 0) - (b.seq || 0)) // Sort by sequence
          .map((m) => (
            <p key={m.id}>
              {m.text}{" "}
              {m.delivered ? (
                <span className="text-green-500">✅</span>
              ) : (
                <span className="text-yellow-500">⏳</span>
              )}
            </p>
          ))}
      </div>

      {joined && (
        <div className="flex gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Type a message..."
            className="border p-2 flex-1"
          />
          <button
            onClick={sendMessage}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            Send
          </button>
        </div>
      )}
    </main>
  );
}
