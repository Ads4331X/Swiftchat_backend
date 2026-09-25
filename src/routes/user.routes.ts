import * as express from "express";
import auth from "../middleware/auth.js";
import * as userController from "../controllers/user.controller.js";
import { upload } from "../config/multer.js";

const router = express.Router();

router.get("/user-details", auth, userController.getUserDetails);

router.post(
  "/update-profile-picture",
  auth,
  upload.single("avatar"),
  userController.updateAvatar,
);

router.patch("/update-user-info", auth, userController.updateUserInfo);

router.post("/verify-password", auth, userController.verifyPassword);

router.patch("/change-password", auth, userController.changePassword);

router.get("/search", auth, userController.searchUser);

router.delete("/account", auth, userController.deleteAccount);

router.put("/public-key", auth, userController.updatePublicKey);

router.get("/:userId/public-key", auth, userController.getUserPublicKey);

router.get("/key-backup", auth, userController.getKeyBackUp);

router.put("/key-backup", auth, userController.updateKeyBackUp);

// Block routes must come before "/:id" so they aren't captured as a user id.
router.post("/block", auth, userController.blockUser);
router.get("/blocks", auth, userController.getBlockedUsers);
router.delete("/block", auth, userController.unblockUser);

router.get("/:id", auth, userController.getOtherUser);

export default router;
