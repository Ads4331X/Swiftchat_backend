import { AppError } from "../errors/AppError.js";
import { findAttachment } from "../helpers/helper.js";
import prisma from "../prisma.js";
import { unlink } from "node:fs/promises";

export async function getAttachment({ messageId }: { messageId: number }) {
  const attachment = await findAttachment(messageId);
  if (!attachment) throw new AppError("Attachment not found", 404);
  return attachment;
}

export async function removeUploadedFile(filePath: string) {
  await unlink(filePath).catch(() => {});
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
