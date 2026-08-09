import express from "express";
import cors from "cors";
import "dotenv/config";
import auth from "./routes/auth.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", auth);

app.get("/", (req, res) => {
  res.json({ message: "Chat API is running" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
