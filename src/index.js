// const express = require("express");
import express from "express";
import authRoutes from "./routes/auth-route.js";
import dotenv from "dotenv";
import connectDb from "./lib/db.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import messageRoutes from "./routes/message-route.js";
import { io, server, app } from "./lib/socket.js";
// const app = express();
dotenv.config();
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
const PORT = process.env.PORT || 5000;
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

server.listen(PORT, () => {
  console.log("Server is running on port " + PORT);
  connectDb();
});
