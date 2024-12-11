import express from "express";
import mongoose from "mongoose";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import helmet from "helmet";

dotenv.config();

// Validate environment variables
const requiredEnv = ["MONGO_URI", "CLIENT_URI"];
requiredEnv.forEach((env) => {
  if (!process.env[env]) {
    throw new Error(`Missing required environment variable: ${env}`);
  }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URI,
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URI,
    methods: ["GET", "POST"],
  })
);
app.use(express.json());
app.use(morgan("dev"));
app.use(helmet());

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

// Message Schema
const messageSchema = new mongoose.Schema({
  username: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  delivered: { type: Boolean, default: false },
  seenBy: { type: [String], default: [] },
});

const Message = mongoose.model("Message", messageSchema);

// API Routes
app.get("/api/messages", async (req, res, next) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    next(error);
  }
});
app.get("/", async (req, res) => {
  res.json({ message: "server running...", requestip: req.ip });
});

app.post("/api/messages", async (req, res, next) => {
  try {
    const { username, content } = req.body;
    const message = new Message({ username, content, delivered: true });
    await message.save();
    io.emit("new-message", message);
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

// Socket.IO Handlers
let onlineUsers = [];

io.on("connection", (socket) => {
  console.log("New user connected");
  socket.emit("online-users", onlineUsers);

  socket.on("set-username", (username) => {
    if (!onlineUsers.includes(username)) {
      onlineUsers.push(username);
    }
    io.emit("online-users", onlineUsers);
  });

  socket.on("typing", (username) => socket.broadcast.emit("typing", username));

  socket.on("mark-as-seen", async ({ messageId, username }) => {
    try {
      await Message.findByIdAndUpdate(messageId, {
        $addToSet: { seenBy: username },
      });
      socket.emit("message-seen", { messageId, username });
      socket.broadcast.emit("message-seen", { messageId, username });
    } catch (error) {
      console.error("Error marking message as seen:", error.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
    onlineUsers = onlineUsers.filter((user) => user !== socket.username);
    io.emit("online-users", onlineUsers);
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ error: "Internal Server Error" });
});

// Graceful Shutdown
const shutdown = () => {
  console.log("Shutting down server...");
  server.close(() => {
    console.log("Server closed");
    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed");
      process.exit(0);
    });
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start Server
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
