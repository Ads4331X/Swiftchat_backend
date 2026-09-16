import { Response, Request } from "express";
import * as groupServices from "../services/group.service.js";
import { handleError } from "../helpers/error.js";
import {
  checkAdmin,
  emitToConversation,
  ensureMember,
  findMember,
  findUser,
  parseId,
} from "../helpers/helper.js";

export async function createGroup(req: Request, res: Response) {
  try {
    // gets the group details from the user
    const { name, membersId } = req.body;
    const userId = req.userId!;
    // check if the group has enough members or not
    if (!membersId || membersId.length < 1)
      return res.status(400).json({
        error: "It is still 1 to 1 conversation",
      });
    const group = await groupServices.createGroup({
      userId,
      name,
      membersId,
    });

    return res.status(201).json(group);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function addMembers(req: Request, res: Response) {
  try {
    // gets the user ids and conversation id
    const { userIds } = req.body;
    const conversationId = parseId(req.params.id as string);

    // check if the user ids are validate or not
    if (!Array.isArray(userIds) || userIds.length === 0)
      return res.status(400).json({ error: "Invalid userIds send or null" });

    // check if the user is a member of the conversation or not
    await ensureMember(conversationId, req.userId!);

    const addGroupMembers = await groupServices.addMembers({
      userIds,
      conversationId,
    });
    res.status(201).json({ added: addGroupMembers });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function removeGroupMember(req: Request, res: Response) {
  try {
    // gets the required data ( userid and conversation id)
    const userId = parseId(req.params.userId as string);
    const conversationId = parseId(req.params.id as string);

    // check the one who is removing the user is admin of the group (conversation) or not
    const conversation = await checkAdmin(conversationId, req.userId!);

    if (!conversation)
      return res
        .status(403)
        .json({ error: "You are not the admin of the group" });

    // check if the user exists or not
    const user = await findUser(userId);

    if (!user) return res.status(404).json({ error: "User not found" });

    // check if the user is in the conversation (group) or not
    const member = await findMember(conversationId, userId);

    if (!member)
      return res
        .status(404)
        .json({ error: "User is not a member of this conversation" });

    await groupServices.removeGroupMember({ conversationId, userId });

    return res.status(200).json({ message: "User removed from conversation" });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function changeGroupName(req: Request, res: Response) {
  try {
    const { name } = req.body;

    if (typeof name !== "string") {
      return res.status(400).json({
        error: "Name must be a string",
      });
    }

    const trimmedName = name.trim();

    if (!trimmedName) {
      return res.status(400).json({
        error: "Name cannot be empty",
      });
    }

    const conversationId = parseId(req.params.id as string);
    const userId = req.userId!;

    const updatedConversation = await groupServices.changeGroupName({
      conversationId,
      userId,
      trimmedName,
    });

    return res.status(200).json({
      message: "Group name changed",
      conversation: updatedConversation,
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function leaveGroup(req: Request, res: Response) {
  try {
    const conversationId = parseId(req.params.id as string);

    // check if user exists
    const user = await findUser(req.userId!);

    if (!user) return res.status(404).json({ error: "User not found" });

    // check if user is in the group
    const inConversation = await findMember(conversationId, req.userId!);

    if (!inConversation)
      return res.status(401).json({ error: "You are not in the conversation" });

    await groupServices.leaveGroup({
      conversationId,
      userId: req.userId!,
    });

    return res.status(200).json({ message: "User removed from conversation" });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function deleteGroup(req: Request, res: Response) {
  try {
    // gets the required data ( userid and conversation id)
    const conversationId = parseId(req.params.id as string);
    // check if the user exists or not
    const user = await findUser(req.userId!);

    if (!user) return res.status(404).json({ error: "User not found" });

    // check the one who is deleting the group is admin or not
    const conversation = await checkAdmin(conversationId, user.id);

    if (!conversation)
      return res
        .status(403)
        .json({ error: "You are not the admin of the group" });

    // check if the user is in the conversation (group) or not
    const member = await findMember(conversationId, user.id);

    if (!member)
      return res
        .status(404)
        .json({ error: "User is not a member of this conversation" });

    // removes the conversation and the message ( delete all the things of the group)
    await groupServices.deleteGroup({ conversationId });

    const io = req.app.get("io");
    emitToConversation(io, conversationId, "group-deleted", { conversationId });

    return res
      .status(200)
      .json({ message: "Group deleted with all data erased" });
  } catch (err) {
    return handleError(err, res);
  }
}
