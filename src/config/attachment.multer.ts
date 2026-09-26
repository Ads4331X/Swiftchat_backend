import { randomBytes } from "node:crypto";
import multer from "multer";
import { join } from "node:path";

const uploadDestination = join(__dirname, "uploads", "attachments");
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

export const upload = multer({ storage: storage });
