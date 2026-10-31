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
    const conversationId = parseId(req.params.id as string);
    const userId = parseId(req.params.userId as string);
    const { encryptedKey, nonce, epoch } = req.body;

    // Validate required fields
    if (!encryptedKey || !nonce || epoch === undefined) {
      return res.status(400).json({
        error: "encryptedKey, nonce and epoch are required",
      });
    }

    // Validate epoch
    if (!Number.isInteger(epoch) || epoch < 1) {
      return res.status(400).json({
        error: "Invalid key epoch",
      });
    }

    // Check requester membership
    await ensureMember(conversationId, req.userId!);

    // Check target membership
    const targetMember = await findMember(conversationId, userId);

    if (!targetMember) {
      return res.status(404).json({
        error: "Target user is not a member of this conversation",
      });
    }

    await ConversationServices.getEncryptedMemberKey({
      conversationId,
      userId,
      requesterId: req.userId!,
      nonce,
      epoch,
      encryptedKey,
    });

    return res.status(200).json({
      message: "Conversation key stored successfully",
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getEncryptedKey(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.id as string);
    const userId = req.userId!;

    // check if user is the member or not
    await ensureMember(conversationId, userId);

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

export async function getHistoricalKeyPackages(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.id as string);
    const userId = req.userId!;

    const result = await ConversationServices.getHistoricalKeyPackages({
      conversationId,
      userId,
    });

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
