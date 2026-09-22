import multer from "multer";

const storage = multer.memoryStorage();
const maxUploadSize = 5 * 1024 * 1024; // 5MB
const upload = multer({
  storage: storage,
  limits: { fileSize: maxUploadSize },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/jpg"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .jpeg, .jpg and .png files are allowed!"));
    }
  },
});

export { upload };
