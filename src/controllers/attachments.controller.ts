import { Request, Response } from "express";
import {
  ensureMember,
  findAndValidateMessage,
  findMessage,
  parseId,
} from "../helpers/helper.js";
import { handleError } from "../helpers/error.js";
import * as attachmentServices from "../services/attachments.services.js";
import { createReadStream } from "node:fs";

export async function getAttachment(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const messageId = parseId(req.params.messageId as string);

    const message = await findMessage(messageId);
    if (!message) return res.status(400).json({ error: "Message not found" });
    await ensureMember(message.conversationId, userId);

    const result = await attachmentServices.getAttachment({
      messageId,
    });
    // creates a stream
    const stream = createReadStream(result.filePath);
    res.setHeader("Content-Type", "application/octet-stream");
    stream.pipe(res);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function deleteAttachment(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const messageId = parseId(req.params.messageId as string);

    await findAndValidateMessage(messageId, userId);

    const delAttachment = await attachmentServices.deleteAttachment({
      messageId,
    });
    return res.status(200).json(delAttachment);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getAttachmentMetadata(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const messageId = parseId(req.params.messageId as string);

    const message = await findMessage(messageId);
    if (!message) return res.status(400).json({ error: "Message not found" });

    await ensureMember(message.conversationId, userId);

    const result = await attachmentServices.getAttachment({
      messageId,
    });

    return res.json(result);
  } catch (err) {
    return handleError(err, res);
  }
}
