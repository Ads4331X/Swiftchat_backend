import { Request, Response } from "express";
import * as ConversationServices from "../services/conversation.service.js";
import { handleError } from "../helpers/error.js";
import { ensureMember, findMember, parseId } from "../helpers/helper.js";

export async function getConversations(req: Request, res: Response) {
  try {
    const userId = req.userId!;

    const result = await ConversationServices.getConversations({ userId });
    return res.json(result);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function createConversation(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    // gets the target username from the user
    const { targetUsername } = req.body;

    const result = await ConversationServices.createConversation({
      targetUsername,
      userId,
    });

    return res.status(result.existing ? 200 : 201).json({
      message: result.existing
        ? "Conversation already exists"
        : "Conversation created",
      conversation: result.conversation,
    });
  } catch (err) {
    handleError(err, res);
  }
}

export async function getEncryptedMemberKey(req: Request, res: Response) {
  try {
    // gets the required data ( conversation id and user id)
    const conversationId = parseId(req.params.id as string);
    const userId = parseId(req.params.userId as string);
    const { encryptedKey, nonce } = req.body;

    // check if the required fields are present or not
    if (!encryptedKey || !nonce)
      return res
        .status(400)
        .json({ error: "encryptedKey and nonce are required" });

    // check if requester is a member
    await ensureMember(conversationId, req.userId!);

    // check if target user is a member
    const targetMember = await findMember(conversationId, userId);
    if (!targetMember)
      return res.status(404).json({
        error: "Target user is not a member of this conversation",
      });

    await ConversationServices.getEncryptedMemberKey({
      conversationId,
      userId,
      requesterId: req.userId!,
      nonce,
      encryptedKey,
    });

    return res
      .status(200)
      .json({ message: "Conversation key stored successfully" });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getEncryptedKey(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.id as string);
    const userId = req.userId!;

    const result = await ConversationServices.getEncryptedKey({
      conversationId,
      userId,
    });

    if (!result) {
      return res.status(403).json({
        error: "You are not a member of this conversation",
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function claimKey(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.id as string);
    const userId = req.userId!;

    // check if requester is a member
    await ensureMember(conversationId, userId);

    const result = await ConversationServices.claimConversationKey({
      conversationId,
      userId,
    });

    if (!result.claimed) {
      return res.status(409).json(result);
    }

    return res.status(200).json(result);
  } catch (err) {
    return handleError(err, res);
  }
}
