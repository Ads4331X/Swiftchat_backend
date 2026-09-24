import express from "express";
import cors from "cors";
import "dotenv/config";
import auth from "./routes/auth.routes.js";
import user from "./routes/user.routes.js";
import conversation from "./routes/conversations.routes.js";
import { Server } from "socket.io";
import http from "http";
import { setupSocket } from "./socket.js";
import { testCloudinary } from "./config/cloudinary.js";

const app = express();
// app.use(cors());
app.use(express.json());

const server = http.createServer(app);

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  }),
);

// Enable CORS for Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

setupSocket(io);
app.set("io", io);
app.use("/api/auth", auth);
app.use("/api/user", user);
app.use("/api/conversations", conversation);

app.get("/", (_req, res) => {
  res.json({ message: "Chat API is running" });
});

testCloudinary();
const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`- Local:   http://localhost:${PORT}`);
  console.log(`- Network: http://192.168.1.72:${PORT}`);
});
