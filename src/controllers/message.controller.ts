import { Request, Response } from "express";
import {
  emitToConversation,
  ensureMember,
  findAndValidateMessage,
  findForPin,
  findForPinRead,
  findMember,
  findMessage,
  findUser,
  normalizeNonce,
  parseId,
  validateEmoji,
  validateMessageId,
} from "../helpers/helper.js";
import * as messageService from "../services/message.service.js";
import { handleError } from "../helpers/error.js";

export async function getMessages(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const conversationId = parseId(req.params.conversationId as string);

    const membership = await ensureMember(conversationId, userId);

    const clearedAt = membership.clearedAt;

    const limit = Math.min(
      req.query.limit ? parseId(String(req.query.limit)) : 50,
      200,
    );

    const before = req.query.before
      ? parseId(String(req.query.before))
      : undefined;

    const messages = await messageService.getMessages({
      conversationId,
      clearedAt,
      limit,
      before,
    });

    return res.json(messages);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function sendMessages(req: Request, res: Response) {
  try {
    // gets the message details from the user
    const {
      messageText,
      conversationId: rawConversationId,
      nonce,
      replyToId: rawReplyToId,
      forwardedFromMsgId: rawForwardedFromMsgId,
    } = req.body;

    const senderId = req.userId!;

    // check if the required fields are present or not
    if (!messageText || !nonce || !rawConversationId) {
      return res.status(400).json({
        error: "messageText, nonce, and conversationId are required",
      });
    }

    const conversationId = parseId(String(rawConversationId));
    const forwardedFromMsgId = rawForwardedFromMsgId
      ? parseId(String(rawForwardedFromMsgId))
      : null;
    const replyToId = rawReplyToId ? parseId(String(rawReplyToId)) : null;

    const normalizedNonce = normalizeNonce(nonce);

    // check if user is a member of the conversation
    await ensureMember(conversationId, senderId);

    const sendMessage = await messageService.sendMessages({
      conversationId: conversationId,
      senderId: senderId,
      text: messageText,
      nonce: normalizedNonce,
      replyToId: replyToId,
      forwardedFromMsgId: forwardedFromMsgId,
    });

    // emits the new message to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, conversationId, "new-message", sendMessage);

    return res.status(201).json(sendMessage);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function editMessage(req: Request, res: Response) {
  try {
    // gets the message details from the user
    const messageId = parseId(req.params.id as string);
    const { text, nonce } = req.body;

    // check if the required fields are present or not
    if (!text || !nonce || Number.isNaN(messageId)) {
      return res.status(400).json({ error: "text and nonce are required" });
    }

    const normalizedNonce = normalizeNonce(nonce);

    // find message and check ownership
    const message = await findAndValidateMessage(messageId, req.userId!);

    // edit the message
    const updatedMessage = await messageService.editMessage({
      messageId,
      nonce: normalizedNonce,
      text,
    });

    // emits the updated message to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(
      io,
      message.conversationId,
      "message-updated",
      updatedMessage,
    );

    return res.status(200).json(updatedMessage);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function deleteMessage(req: Request, res: Response) {
  try {
    // gets the message id
    const messageId = parseId(req.params.id as string);

    // find message and check ownership
    const message = await findAndValidateMessage(messageId, req.userId!);

    const deleteMsg = await messageService.deleteMessage({ messageId });
    // emits the deleted message id to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, message.conversationId, "message-deleted", {
      id: messageId,
    });

    return res.status(200).json(deleteMsg);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getMessageReadStatus(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.conversationId as string);
    const messageId = parseId(req.params.messageId as string);
    const userId = req.userId!;

    // validates user exists, membership and that the message exists
    await findForPinRead(conversationId, messageId, userId);

    const messageReadUsersDetails = await messageService.getMessageReadStatus({
      messageId,
      conversationId,
    });

    return res.status(200).json(messageReadUsersDetails);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function markMessagesAsRead(req: Request, res: Response) {
  try {
    // gets the user id, conversation id and message id
    const userId = req.userId!;
    const conversationId = parseId(req.params.conversationId as string);
    const { messageId } = req.body;

    // check if the required fields are present or not
    if (!conversationId || !messageId) {
      return res.status(400).json({
        error: "conversationId and messageId are required",
      });
    }

    // check if user is a member
    await ensureMember(conversationId, userId);

    const markRead = await messageService.markMessagesAsRead({
      conversationId,
      messageId,
      userId,
    });
    // emits the mark-read event to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, conversationId, "mark-read", {
      conversationId,
      messageId,
      userId,
      readAt: markRead,
    });

    return res.status(200).json({
      message: "Messages marked as read",
      conversationId,
      messageId,
      userId,
      readAt: markRead,
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function addReaction(req: Request, res: Response) {
  try {
    const { emoji } = req.body;
    const messageId = parseId(req.params.id as string);
    const userId = req.userId!;

    validateMessageId(messageId);
    validateEmoji(emoji);
    const message = await findMessage(messageId);

    if (!message) return res.status(404).json({ error: "Message not found" });

    const result = await messageService.addReaction({
      messageId: message.id,
      userId,
      emoji,
    });

    return res.status(201).json(result);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function deleteReaction(req: Request, res: Response) {
  try {
    // gets the message id and emoji from the user
    const { emoji } = req.body;
    const messageId = parseId(req.params.id as string);
    const userId = req.userId!;
    // check if the message id is validate or not
    validateMessageId(messageId);

    // check if the message exists or not
    const message = await findMessage(messageId);

    if (!message) return res.status(404).json({ error: "Message not found" });

    const deleteReaction = await messageService.deleteReaction({
      userId,
      messageId,
    });

    // emits the removed reaction to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, message.conversationId, "message-reaction", {
      conversationId: message.conversationId,
      messageId: message.id,
      userId,
      emoji,
      removed: true,
    });

    return res.status(200).json(deleteReaction);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getPinnedMessages(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.conversationId as string);
    const messageId = parseId(req.params.messageId as string);
    const userId = req.userId!;

    await findForPinRead(conversationId, messageId, userId);

    const pinnedMsgs = await messageService.getPinnedMessages({
      conversationId,
    });

    return res.status(200).json(pinnedMsgs);
  } catch (error) {
    return handleError(error, res);
  }
}

export async function pinMessage(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.conversationId as string);
    const messageId = parseId(req.params.messageId as string);
    const userId = req.userId!;

    await findForPin(conversationId, messageId, userId);

    const pinMsg = await messageService.pinMessage({
      userId,
      messageId,
      conversationId,
    });
    return res.status(200).json(pinMsg);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function deletePin(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.conversationId as string);
    const messageId = parseId(req.params.messageId as string);

    await findForPin(conversationId, messageId, req.userId!);

    const pinMsg = await messageService.deletePin({
      messageId,
      conversationId,
    });
    return res.status(200).json(pinMsg);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function clearChat(req: Request, res: Response) {
  try {
    const user = await findUser(req.userId!);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const conversationId = parseId(req.params.conversationId as string);

    const member = await findMember(conversationId, user.id);

    if (!member) {
      return res.status(404).json({
        error: "User is not a member of this conversation",
      });
    }

    const clearedAt = await messageService.clearChat({
      conversationId,
      userId: req.userId!,
    });

    return res.status(200).json({
      message: "Conversation cleared successfully",
      clearedAt: clearedAt,
    });
  } catch (err) {
    return handleError(err, res);
  }
}
