import * as nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  service: "Gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.NODEMAILER_GMAIL_EMAIL,
    pass: process.env.NODEMAILER_GMAIL_PASSWORD,
  },
});
