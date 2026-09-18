import { parseId } from "../helpers/helper.js";
import { handleError } from "../helpers/error.js";
import * as userServices from "../services/user.service.js";
import { Request, Response } from "express";

export async function getUserDetails(req: Request, res: Response) {
  try {
    const userId = req.userId!;

    const result = await userServices.getUserDetails(userId);
    return res.json(result);
  } catch (err) {
    return handleError(err, res);
  }
}
export async function updateUserInfo(req: Request, res: Response) {
  try {
    // gets the user details to update
    const { username, email } = req.body;
    const userId = req.userId!;

    const result = await userServices.updateUserInfo({
      userId,
      username,
      email,
    });

    return res.json(result);
  } catch (err: any) {
    // Handle duplicate username/email (unique constraints)
    if (err?.code === "P2002") {
      // Prisma 7 with adapter-pg nests the constraint fields here
      const fields =
        err.meta?.driverAdapterError?.cause?.constraint?.fields ||
        err.meta?.target ||
        [];
      if (fields.includes("username")) {
        return res.status(409).json({ error: "Username already taken" });
      }
      return res.status(409).json({ error: "Email already in use" });
    }
    if (err?.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }
    return handleError(err, res);
  }
}

export async function verifyPassword(req: Request, res: Response) {
  try {
    // gets the current password from the user
    const { currentPassword } = req.body;

    // check if the password is empty or not
    if (!currentPassword)
      return res.status(400).json({ error: "Current password is required" });

    const userId = req.userId!;

    const result = await userServices.verifyPassword({
      userId,
      currentPassword,
    });

    if (!result) return res.status(401).json({ verify: false });
    else return res.status(200).json({ verify: true });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function changePassword(req: Request, res: Response) {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    // check if the current password is empty or not
    if (!currentPassword)
      return res.status(400).json({ error: "Current password is required" });

    const userId = req.userId!;

    const result = await userServices.changePassword({
      userId,
      currentPassword,
      newPassword,
      confirmNewPassword,
    });

    return res.status(200).json({ message: result });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function searchUser(req: Request, res: Response) {
  try {
    // gets the username to search
    const { username } = req.query;

    // check if the username is empty or not
    if (!String(username)?.trim())
      return res.status(400).json({
        error: "Username is required",
      });

    const userId = req.userId!;

    const result = await userServices.searchUser({
      userId,
      username: String(username),
    });

    return res.status(200).json(result);
  } catch (err) {
    handleError(err, res);
  }
}

export async function deleteAccount(req: Request, res: Response) {
  try {
    const userId = req.userId!;

    const result = await userServices.deleteAccount({ userId });
    return res.status(200).json({ message: result });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }
    return handleError(err, res);
  }
}

export async function updatePublicKey(req: Request, res: Response) {
  try {
    // gets the public key from the user
    const { publicKey } = req.body;

    // check if the public key is empty or not
    if (!publicKey)
      return res.status(400).json({
        error: "Public key is required",
      });

    const userId = req.userId!;

    const result = await userServices.updatePublicKey({
      userId,
      publicKey: String(publicKey),
    });
    return res.status(200).json({
      message: result,
    });
  } catch (err: any) {
    if (err?.code === "P2025")
      return res.status(404).json({
        error: "User not found",
      });
    return handleError(err, res);
  }
}

export async function getUserPublicKey(req: Request, res: Response) {
  try {
    // gets the targeted user id
    const targetedUserId = parseId(String(req.params.userId));

    const result = await userServices.getUserPublicKey({ targetedUserId });
    return res.status(200).json({
      publicKey: result,
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getKeyBackUp(req: Request, res: Response) {
  try {
    const userId = req.userId!;

    const result = await userServices.getKeyBackUp({ userId });
    return res.status(200).json(result);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function updateKeyBackUp(req: Request, res: Response) {
  try {
    const userId = req.userId!;

    // gets the key backup details from the user
    const {
      keyBackupEncrypted: encryptedPrivateKey,
      keyBackupNonce: nonce,
      keyBackupSalt: salt,
      keyBackupOpsLimit: opsLimit,
      keyBackupMemLimit: memLimit,
      keyBackupAlg: alg,
    } = req.body;

    // check if the required fields are present or not
    if (!encryptedPrivateKey || !nonce || !salt)
      return res.status(400).json({
        error: "key is required",
      });

    const result = await userServices.updateKeyBackUp({
      userId,
      encryptedPrivateKey,
      nonce,
      salt,
      opsLimit,
      memLimit,
      alg,
    });
    return res.status(200).json({
      message: result,
    });
  } catch (err: any) {
    if (err?.code === "P2025")
      return res.status(404).json({
        error: "User not found",
      });

    return handleError(err, res);
  }
}

export async function getOtherUser(req: Request, res: Response) {
  try {
    // gets the targeted user id
    const targetedUserId = parseInt(String(req.params.id));
    const result = await userServices.getOtherUser({ targetedUserId });

    return res.status(200).json(result);
  } catch (err) {
    return handleError(err, res);
  }
}
