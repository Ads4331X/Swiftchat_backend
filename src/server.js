import express from "express";
import cors from "cors";
import "dotenv/config";
import auth from "./routes/auth.js";
import user from "./routes/user.js";
import conversation from "./routes/conversations.js";
import { Server } from "socket.io";
import http from "http";
import jwt from "jsonwebtoken";
import { setupSocket } from "./socket.js";

const app = express();
// app.use(cors());
app.use(express.json());

const server = http.createServer(app);

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Enable CORS for Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

setupSocket(io);
app.set("io", io);
app.use("/api/auth", auth);
app.use("/api/user", user);
app.use("/api/conversations", conversation);

app.get("/", (req, res) => {
  res.json({ message: "Chat API is running" });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
