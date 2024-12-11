import express from "express";
import mongoose from "mongoose";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URI,
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin: process.env.CLIENT_URI,
    methods: ["GET", "POST"],
  })
);
app.use(express.json());
app.use(morgan("dev"));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

const messageSchema = new mongoose.Schema({
  username: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  delivered: { type: Boolean, default: false },
  seenBy: { type: [String], default: [] },
});

const Message = mongoose.model("Message", messageSchema);
// await Message.deleteMany();
app.get("/api/messages", async (req, res) => {
  const messages = await Message.find().sort({ timestamp: 1 });
  res.json(messages);
});

app.post("/api/messages", async (req, res) => {
  const { username, content } = req.body;
  const message = new Message({ username, content, delivered: true });
  await message.save();
  io.emit("new-message", message);
  res.status(201).json(message);
});
let onlineUsers = [];
io.on("connection", (socket) => {
  console.log("New user connected");
  socket.emit("online-users", onlineUsers);
  socket.on("set-username", (username) => {
    console.log("New user connected", username);

    if (!onlineUsers.includes(username)) {
      onlineUsers.push(username);
    }
    io.emit("online-users", onlineUsers);
  });
  socket.on("typing", (username) => socket.broadcast.emit("typing", username));
  socket.on("mark-as-seen", async ({ messageId, username }) => {
    await Message.findByIdAndUpdate(messageId, {
      $addToSet: { seenBy: username },
    });
    socket.emit("message-seen", { messageId, username });
    socket.broadcast.emit("message-seen", { messageId, username });
  });

  socket.on("disconnect", () => {
    onlineUsers = onlineUsers.filter((user) => user !== socket.username);
    io.emit("online-users", onlineUsers);
    console.log("A user disconnected");
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
