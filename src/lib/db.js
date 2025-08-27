import mongoose from "mongoose";

const connectDb = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1); // Exit the process with failure
  }
};
export default connectDb;

// import mongoose from "mongoose";

// const connectDb = async () => {
//   try {
//       useNewUrlParser: true,
//       useUnifiedTopology: true,
//       serverSelectionTimeoutMS: 15000, // wait 15s before failing
//       connectTimeoutMS: 15000, // timeout for initial connection
//     });

//     console.log("✅ MongoDB connected successfully");
//   } catch (error) {
//     console.error("❌ MongoDB connection failed:");

//     process.exit(1);
//   }
// };

// export default connectDb;
