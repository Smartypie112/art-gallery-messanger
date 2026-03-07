require("dotenv").config();
const express = require("express");
const cors = require("cors");
const twilio = require("twilio");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const mongoose = require('mongoose');
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// store otp temporarily
const otpStore = {};
const upload = multer({ dest: "uploads/" });
const candidateSchema = new mongoose.Schema({
  Phone: { type: String, required: true, unique: true },
  Name: String,
  Date: Date,
  Qualification: String,
  City: String,
  PreviousDetails: String,
  Images: [String],

  // for jury selection
  SelectedImages: [String],
  Qualified: {
    type: Boolean,
    default: false
  }
});

const Candidate = mongoose.model("Candidate", candidateSchema, "candidate");
// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post("/upload-images", upload.array("images", 5), async (req, res) => {
  try {

    const files = req.files;

    const uploadPromises = files.map(file =>
      cloudinary.uploader.upload(file.path)
    );

    const results = await Promise.all(uploadPromises);

    const imageUrls = results.map(result => result.secure_url);

    // 🔥 Delete temporary multer files
    files.forEach(file => {
      fs.unlinkSync(file.path);
    });

    res.json({
      success: true,
      images: imageUrls
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});
//Select Images for qualification
app.post("/select-images", async (req, res) => {
  try {
    const { id, selectedImages } = req.body;

    if (selectedImages.length !== 2) {
      return res.json({
        success: false,
        message: "Exactly 2 images required"
      });
    }

    // Update candidate
    const candidate = await Candidate.findByIdAndUpdate(
      id,
      { SelectedImages: selectedImages, Qualified: true },
      { new: true }
    );

    if (candidate) {
      const whatsappNumber = `whatsapp:${candidate.Phone}`;
      // 2️⃣ Send message with second image only
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: whatsappNumber,
        mediaUrl: [selectedImages[1]]
      });
      // 1️⃣ Send message with first image and text
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: whatsappNumber,
        body: `Congrats! Your 2 artworks are selected for the 2nd round. For qualifying for 2nd round you have to pay a minimal amount.

Please pay ₹500 by this link: 
https://dummy-payment-link.com`,
        mediaUrl: [selectedImages[0]]
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
  }
});
// Load application to admin 
app.get("/applications", async (req, res) => {
  try {

    const candidates = await Candidate.find().sort({ _id: -1 });

    res.json(candidates);

  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
  }
});
// SEND OTP
app.post("/send-otp", async (req, res) => {
  const { phone } = req.body;

  try {
    const otp = generateOTP();

    // store otp
    otpStore[phone] = otp;

    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${phone}`,
      body: `Your OTP is: ${otp}`
    });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// VERIFY OTP
app.post("/verify-otp", async (req, res) => {
  try {
    const {
      phone,
      otp,
      name,
      date,
      qualification,
      city,
      previousDetails,
      images
    } = req.body;

    if (otpStore[phone] && otpStore[phone] === otp) {

      delete otpStore[phone];

      const newCandidate = new Candidate({
        Phone: phone,
        Name: name,
        Date: date,
        Qualification: qualification,
        City: city,
        PreviousDetails: previousDetails,
        Images: images   // save image links
      });

      await newCandidate.save();

      res.json({ success: true });

    } else {
      res.json({ success: false, message: "Invalid OTP" });
    }

  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false });
  }
});


app.listen(5000, () => {
  console.log("Server running on port 5000");
});