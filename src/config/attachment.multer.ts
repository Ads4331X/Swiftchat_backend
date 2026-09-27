import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import multer from "multer";
import { join } from "node:path";
import { ALLOWED_MIME_TYPES, LIMITS } from "../types/attachments.types.js";

// max size of each attachment
const MAX_SIZE_BY_CATEGORY: Record<string, number> = {
  image: LIMITS.IMAGE_MAX_SIZE,
  video: LIMITS.VIDEO_MAX_SIZE,
  voice: LIMITS.VOICE_MAX_SIZE,
  document: LIMITS.DOCUMENT_MAX_SIZE,
};

const MULTER_CEILING_BYTES = LIMITS.VIDEO_MAX_SIZE; // maximum size that can be stored

// returns what type of attachment is it such as image , video , audio , document
export function getAttachmentCategory(mimetype: string): string | null {
  for (const [category, mimes] of Object.entries(ALLOWED_MIME_TYPES)) {
    if (mimes.includes(mimetype)) return category;
  }
  return null;
}

export function validateAttachment(file: Express.Multer.File) {
  const category = getAttachmentCategory(file.mimetype);

  if (!category) {
    return { valid: false as const, error: "Unsupported file type" };
  }

  const maxSize = MAX_SIZE_BY_CATEGORY[category]!;
  if (file.size > maxSize) {
    return {
      valid: false as const,
      error: `${category} exceeds ${maxSize / (1024 * 1024)}MB limit`,
    };
  }

  return { valid: true as const, category };
}

const uploadDestination = join(process.cwd(), "uploads", "attachments");

mkdirSync(uploadDestination, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, uploadDestination);
  },
  filename(req, file, callback) {
    randomBytes(16, (err, raw) => {
      if (err) return callback(err, file.filename);
      callback(null, raw.toString("hex") + ".bin");
    });
  },
});

export const upload = multer({
  storage: storage,
  limits: { fileSize: MULTER_CEILING_BYTES },
});
