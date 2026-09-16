import * as express from "express";
import auth from "../middleware/auth.js";
import * as userController from "../controllers/user.controller.js";

const router = express.Router();

router.get("/user-details", auth, userController.getUserDetails);

router.patch("/update-user-info", auth, userController.updateUserInfo);

router.post("/verify-password", auth, userController.verifyPassword);

router.patch("/change-password", auth, userController.changePassword);

router.get("/search", auth, userController.searchUser);

router.delete("/account", auth, userController.deleteAccount);

router.put("/public-key", auth, userController.updatePublicKey);

router.get("/:userId/public-key", auth, userController.getUserPublicKey);

router.get("/key-backup", auth, userController.getKeyBackUp);

router.put("/key-backup", auth, userController.updateKeyBackUp);

router.get("/:id", auth, userController.getOtherUser);
export default router;
