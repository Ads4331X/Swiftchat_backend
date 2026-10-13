import * as express from "express";
import auth from "../middleware/auth.js";
import * as conversationController from "../controllers/conversation.controller.js";
import * as messageController from "../controllers/message.controller.js";
import * as groupController from "../controllers/group.controller.js";
import * as attachmentController from "../controllers/attachments.controller.js";
import { upload as attachmentUpload } from "../config/attachment.multer.js";
const router = express.Router();

router.get("/", auth, conversationController.getConversations);

router.post(
  "/new-conversation",
  auth,
  conversationController.createConversation,
);

router.get("/messages/:conversationId", auth, messageController.getMessages);

router.post(
  "/messages",
  auth,
  attachmentUpload.single("file"),
  messageController.sendMessages,
);

router.patch("/messages/:id", auth, messageController.editMessage);

router.delete("/messages/:id", auth, messageController.deleteMessage);

router.put(
  "/:id/key/:userId",
  auth,
  conversationController.getEncryptedMemberKey,
);

router.get("/:id/key", auth, conversationController.getEncryptedKey);

router.post("/:id/key", auth, conversationController.claimKey);

router.post(
  "/messages/:conversationId/mark-read",
  auth,
  messageController.markMessagesAsRead,
);

router.post("/messages/:id/reactions", auth, messageController.addReaction);

router.put("/messages/:id/reactions", auth, messageController.addReaction);

router.delete(
  "/messages/:id/reactions",
  auth,
  messageController.deleteReaction,
);

router.post("/group", auth, groupController.createGroup);

router.post("/:id/members", auth, groupController.addMembers);

router.delete("/:id/members/:userId", auth, groupController.removeGroupMember);

router.patch("/:id", auth, groupController.changeGroupName);

router.delete("/:id/leave", auth, groupController.leaveGroup);

// delete a group
router.delete("/:id", auth, groupController.deleteGroup);

router.get(
  "/:conversationId/messages/:messageId/read-status",
  auth,
  messageController.getMessageReadStatus,
);

router.get(
  "/:conversationId/messages/:messageId/pin",
  auth,
  messageController.getPinnedMessages,
);

router.post(
  "/:conversationId/messages/:messageId/pin",
  auth,
  messageController.pinMessage,
);

router.delete(
  "/:conversationId/messages/:messageId/pin",
  auth,
  messageController.deletePin,
);

router.post("/:conversationId/clear", auth, messageController.clearChat);

router.get("/attachments/:messageId", auth, attachmentController.getAttachment);
router.get(
  "/attachments/:messageId/metadata",
  auth,
  attachmentController.getAttachmentMetadata,
);
router.delete(
  "/attachments/:messageId",
  auth,
  attachmentController.deleteAttachment,
);

export default router;
