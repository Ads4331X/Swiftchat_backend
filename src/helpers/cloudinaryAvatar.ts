import { Readable } from "stream";
import type { UploadApiResponse } from "cloudinary";
import cloudinary from "../config/cloudinary.js";

export function uploadAvatar(
  buffer: Buffer,
  userId: number,
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "swiftchat/avatars",
        resource_type: "image",
        public_id: userId.toString(),
        overwrite: true,
        invalidate: true,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (!result) {
          reject(new Error("Cloudinary upload returned no result"));
        } else {
          resolve(result);
        }
      },
    );

    Readable.from(buffer).pipe(stream);
  });
}
