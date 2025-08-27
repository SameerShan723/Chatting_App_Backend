import { Server } from "socket.io";
import http from "http";
import express from "express";
import User from "../models/user-model.js";
import Message from "../models/message-model.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173"],
  },
});

const userSocketMap = {};
export const getReceiverSocketId = (userId) => {
  return userSocketMap[userId];
};

// socket-server-connection
io.on("connection", async (socket) => {
  console.log("A user connected", socket.id);

  const userId = socket.handshake.query.userId;

  if (userId) {
    // map user to socket
    userSocketMap[userId] = socket.id;

    // mark user online
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { isOnline: true },
      { new: true }
    ).select("_id isOnline lastSeen fullName profilePic");

    io.emit("userStatusChanged", updatedUser);

    // ---- Mark undelivered messages as delivered ----
    const undelivered = await Message.find({
      receiverId: userId,
      status: "sent",
    });

    if (undelivered.length > 0) {
      await Message.updateMany(
        { receiverId: userId, status: "sent" },
        { $set: { status: "delivered" } }
      );

      for (const msg of undelivered) {
        const senderSocketId = getReceiverSocketId(msg.senderId.toString());
        const receiverSocketId = getReceiverSocketId(msg.receiverId.toString());

        // sender: message delivered
        if (senderSocketId) {
          io.to(senderSocketId).emit("messageDelivered", msg._id);
          io.to(senderSocketId).emit("updateLastMessage", {
            ...msg.toObject(),
            status: "delivered",
            unreadCount: 0, // sender never has unread
          });
        }

        //  receiver: update sidebar with delivered message
        if (receiverSocketId) {
          const unreadCountForReceiver = await Message.countDocuments({
            senderId: msg.senderId,
            receiverId: msg.receiverId,
            unread: true,
          });

          io.to(receiverSocketId).emit("updateLastMessage", {
            ...msg.toObject(),
            status: "delivered",
            unreadCount: unreadCountForReceiver, // keep real unread count
          });
        }
      }
    }
  }

  // ---- When a user opens a chat, mark messages as seen ----
  socket.on("markMessagesAsSeen", async ({ senderId, receiverId }) => {
    try {
      // only update messages for *this* receiver
      await Message.updateMany(
        { senderId, receiverId, status: { $ne: "seen" } },
        { $set: { status: "seen", unread: false } }
      );

      const lastMessage = await Message.findOne({
        $or: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      })
        .sort({ createdAt: -1 })
        .lean();

      // calculate unread count for this receiver
      // const unreadCountForReceiver = await Message.countDocuments({
      //   senderId,
      //   receiverId,
      //   unread: true,
      // });

      //  notify sender → message seen
      const senderSocketId = getReceiverSocketId(senderId);
      if (senderSocketId && lastMessage) {
        io.to(senderSocketId).emit("messagesSeen", {
          senderId,
          receiverId,
          lastMessage: { ...lastMessage },
        });
        io.to(senderSocketId).emit("updateLastMessage", {
          ...lastMessage,
          // do not zero unread count for sender
        });
      }

      //  notify receiver → clear their badge
      const receiverSocketId = getReceiverSocketId(receiverId);
      if (receiverSocketId && lastMessage) {
        io.to(receiverSocketId).emit("updateLastMessage", {
          ...lastMessage,
          unreadCount: 0, // clear only for logged-in receiver
        });
      }
    } catch (error) {
      console.error("Error marking messages as seen:", error);
    }
  });

  // ---- socket disconnection ----
  socket.on("disconnect", async () => {
    delete userSocketMap[userId];
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { isOnline: false, lastSeen: new Date() },
      { new: true }
    ).select("_id isOnline lastSeen fullName profilePic");

    io.emit("userStatusChanged", updatedUser);
  });
});

export { io, server, app };
