import { AppError } from "../errors/AppError.js";
import { findAttachment } from "../helpers/helper.js";
import prisma from "../prisma.js";
import { unlink } from "node:fs/promises";

export async function getAttachment({ messageId }: { messageId: number }) {
  const attachment = await findAttachment(messageId);
  if (!attachment) throw new AppError("Attachment not found", 404);
  return attachment;
}

export async function sendAttachment({
  messageId,
  file,
}: {
  messageId: number;
  file: Express.Multer.File;
}) {
  const filePath = file.path;
  const mimeType = file.mimetype;
  const fileSize = file.size;

  const uploadAttachment = await prisma.attachment.create({
    data: {
      messageId,
      filePath,
      fileSize,
      mimeType,
    },
  });

  return uploadAttachment;
}

export async function deleteAttachment({ messageId }: { messageId: number }) {
  const attachment = await findAttachment(messageId);
  if (!attachment) throw new AppError("Attachment not found", 404);
  // delete the file on server (disk)
  await unlink(attachment.filePath);

  const delAttachment = await prisma.attachment.delete({
    where: { messageId },
  });
  return delAttachment;
}
