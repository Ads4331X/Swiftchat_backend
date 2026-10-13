export const LIMITS = {
  IMAGE_MAX_SIZE: 10 * 1024 * 1024, // 10MB
  VIDEO_MAX_SIZE: 200 * 1024 * 1024, // 200MB
  VOICE_MAX_SIZE: 20 * 1024 * 1024, // 20MB
  DOCUMENT_MAX_SIZE: 25 * 1024 * 1024, // 25MB
  VIDEO_MIN_BITRATE: 800_000,
};

export const ALLOWED_MIME_TYPES = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4"],
  voice: ["audio/aac", "audio/mp4", "audio/webm"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/zip",
    "text/plain",
  ],
};
