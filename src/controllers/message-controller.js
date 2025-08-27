import User from "../models/user-model.js";
import Message from "../models/message-model.js";
import cloudinary from "../lib/cloudinary.js";
import { getReceiverSocketId, io } from "../lib/socket.js";

export const getUsersForSidebar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;

    const filteredUsers = await User.find({
      _id: { $ne: loggedInUserId },
    }).select("-password");

    const usersWithLastMessage = await Promise.all(
      filteredUsers.map(async (user) => {
        const lastMessage = await Message.findOne({
          $or: [
            { senderId: loggedInUserId, receiverId: user._id },
            { senderId: user._id, receiverId: loggedInUserId },
          ],
        })
          .sort({ createdAt: -1 })
          .limit(1);

        const unreadCount = await Message.countDocuments({
          senderId: user._id,
          receiverId: loggedInUserId,
          unread: true,
        });
        console.log(user, "users");
        return {
          ...user.toObject(),
          lastMessage: lastMessage || null,
          unreadCount,
        };
      })
    );

    res.status(200).json(usersWithLastMessage);
  } catch (error) {
    console.error("getUsersForSidebar error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { id: userToChatId } = req.params;
    const { before } = req.query;
    const myId = req.user._id;

    const filter = {
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    };

    if (before) filter.createdAt = { $lt: new Date(before) };

    const page = await Message.find(filter).sort({ createdAt: -1 }).limit(30);
    const messages = page.reverse();

    res.status(200).json({
      messages,
      hasMore: page.length === 30,
    });
  } catch (error) {
    console.error("getMessages error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { image, text } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    let imageUrl;
    if (image) {
      const uploadResponse = await cloudinary.uploader.upload(image);
      imageUrl = uploadResponse.secure_url;
    }

    const receiverSocketId = getReceiverSocketId(receiverId);

    const newMessage = new Message({
      senderId,
      receiverId,
      text,
      image: imageUrl,
      status: receiverSocketId ? "delivered" : "sent",
      unread: true,
    });

    await newMessage.save();

    // Send newMessage to receiver
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    // Update unreadCount for sidebar in real-time for both sender and receiver
    const senderSocketId = getReceiverSocketId(senderId);
    const unreadCountForReceiver = await Message.countDocuments({
      senderId,
      receiverId,
      unread: true,
    });
    const unreadCountForSender = await Message.countDocuments({
      senderId: receiverId,
      receiverId: senderId,
      unread: true,
    });

    const updatedLastMessage = {
      ...newMessage.toObject(),
      unreadCount: unreadCountForReceiver,
    };

    // Emit to receiver
    io.to(receiverSocketId)?.emit("updateLastMessage", {
      ...updatedLastMessage,
      unreadCount: unreadCountForReceiver,
    });

    // Emit to sender
    io.to(senderSocketId)?.emit("updateLastMessage", {
      ...updatedLastMessage,
      unreadCount: unreadCountForSender,
    });

    res.status(201).json(newMessage);
  } catch (error) {
    console.error("sendMessage error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const markMessagesAsSeen = async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;

    // Mark messages as read in DB
    await Message.updateMany(
      { senderId, receiverId, unread: true },
      { $set: { unread: false, status: "seen" } }
    );

    // Get latest message
    const lastMessage = await Message.findOne({
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    const senderSocketId = getReceiverSocketId(senderId);
    const receiverSocketId = getReceiverSocketId(receiverId);

    // Calculate unread counts
    const unreadCountForSender = await Message.countDocuments({
      senderId: receiverId,
      receiverId: senderId,
      unread: true,
    });
    const unreadCountForReceiver = await Message.countDocuments({
      senderId,
      receiverId,
      unread: true,
    });

    // Emit to sender
    if (senderSocketId) {
      io.to(senderSocketId).emit("messagesSeen", {
        senderId,
        receiverId,
        lastMessage: lastMessage
          ? { ...lastMessage, unreadCount: unreadCountForSender }
          : null,
      });
    }

    // Emit to receiver
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("updateLastMessage", {
        ...lastMessage,
        unreadCount: unreadCountForReceiver,
      });
    }

    res.status(200).json({ message: "Messages marked as seen" });
  } catch (error) {
    console.error("markMessagesAsSeen error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
