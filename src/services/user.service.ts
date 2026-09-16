import bcrypt from "bcryptjs";
import { AppError } from "../errors/AppError.js";
import prisma from "../prisma.js";
import { updateKeyBackUp, UserDetails } from "../types/auth.type.js";
import {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validateUsername,
} from "../validators/auth.validator.js";

export async function getUserDetails(userId: number) {
  // gets the user details
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      email: true,
      created_at: true,
    },
  });
  // check if user exists or not
  if (!user) throw new AppError("User not found", 404);

  return user;
}

export async function updateUserInfo({ username, email, userId }: UserDetails) {
  // check if the username is validate or not
  const usernameResult = validateUsername(username);
  if (usernameResult.error) throw new AppError(usernameResult.error, 400);

  // check if the email is validate or not
  const emailResult = validateEmail(email);
  if (emailResult.error) throw new AppError(emailResult.error, 400);

  // updates the user details
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      username: usernameResult.data!,
      email: emailResult.data!,
    },
    select: { id: true, username: true, email: true },
  });

  return updatedUser;
}

export async function verifyPassword({
  userId,
  currentPassword,
}: {
  userId: number;
  currentPassword: string;
}) {
  // check if user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password_hash: true },
  });

  if (!user) throw new AppError("User not found", 404);

  // check if the current password matches or not
  const isMatch = await bcrypt.compare(currentPassword, user.password_hash);

  if (!isMatch) return false;

  return true;
}

export async function changePassword({
  userId,
  currentPassword,
  newPassword,
  confirmNewPassword,
}: {
  userId: number;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}) {
  // check if user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password_hash: true },
  });

  if (!user) throw new AppError("User not found", 404);

  // check if the current password matches or not
  const currentMatch = await bcrypt.compare(
    currentPassword,
    user.password_hash,
  );
  if (!currentMatch) throw new AppError("Current password is incorrect", 401);

  // check if the new password is validate or not
  const newPasswordValidate = validatePassword(newPassword);
  if (newPasswordValidate.error)
    throw new AppError(newPasswordValidate.error, 400);

  // check if both the new passwords match or not
  const isMatch = validatePasswordMatch(newPassword, confirmNewPassword);
  if (isMatch.error) throw new AppError(isMatch.error, 400);

  // hash the new password
  const passwordHash = await bcrypt.hash(newPassword, 12);

  // updates the user password
  await prisma.user.update({
    where: { id: userId },
    data: { password_hash: passwordHash },
  });

  return "Password changed successfully";
}

export async function searchUser({
  username,
  userId,
}: {
  username: string;
  userId: number;
}) {
  // search users by username and exclude the current user
  const users = await prisma.user.findMany({
    where: {
      username: {
        contains: String(username).trim(),
        mode: "insensitive",
      },
      id: {
        not: userId,
      },
    },
    select: {
      id: true,
      username: true,
      avatar: true,
    },
    orderBy: {
      username: "asc",
    },
    take: 10,
  });

  return {
    users,
  };
}

export async function deleteAccount({ userId }: { userId: number }) {
  // gets all the conversations the user is a member of
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: userId },
    select: { conversationId: true },
  });
  const conversationIds = memberships.map((m) => m.conversationId);

  // delete all the user data in a single transaction
  await prisma.$transaction(async (tx) => {
    // deletes all the messages sent by the user
    await tx.message.deleteMany({ where: { senderId: userId } });

    // removes the user from all the conversations
    await tx.conversationMember.deleteMany({
      where: { userId: userId },
    });

    // find conversations that are now empty and delete them
    if (conversationIds.length > 0) {
      const remaining = await tx.conversationMember.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { conversationId: true },
      });
      const active = new Set(remaining.map((r) => r.conversationId));
      const emptyConversationIds = conversationIds.filter(
        (id) => !active.has(id),
      );

      // delete the empty conversations and their messages
      if (emptyConversationIds.length > 0) {
        await tx.message.deleteMany({
          where: { conversationId: { in: emptyConversationIds } },
        });
        await tx.conversation.deleteMany({
          where: { id: { in: emptyConversationIds } },
        });
      }
    }

    // deletes the user account
    await tx.user.delete({ where: { id: userId } });
  });

  return "Account deleted successfully";
}

export async function updatePublicKey({
  userId,
  publicKey,
}: {
  userId: number;
  publicKey: string;
}) {
  // saves the public key for the user
  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      publicKey,
    },
  });

  return "Public key saved";
}

export async function getUserPublicKey({
  targetedUserId,
}: {
  targetedUserId: number;
}) {
  // check if the targeted user exists or not
  const targetedUser = await prisma.user.findUnique({
    where: { id: targetedUserId },
    select: { publicKey: true },
  });

  if (!targetedUser) throw new AppError("User not found", 404);

  // check if the targeted user has a public key or not
  if (!targetedUser.publicKey) throw new AppError("Public key not found", 404);

  return targetedUser.publicKey;
}

export async function getKeyBackUp({ userId }: { userId: number }) {
  // gets the key backup details of the user
  const key = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      keyBackupEncrypted: true,
      keyBackupNonce: true,
      keyBackupSalt: true,
      keyBackupOpsLimit: true,
      keyBackupMemLimit: true,
      keyBackupAlg: true,
    },
  });

  // check if the user has a key backup or not
  if (!key || !key.keyBackupEncrypted)
    throw new AppError("No key backup found for this user", 404);

  return {
    keyBackupEncrypted: key.keyBackupEncrypted,
    keyBackupNonce: key.keyBackupNonce,
    keyBackupSalt: key.keyBackupSalt,
    // KDF/encryption parameters are non-secret metadata; the server only
    // stores them so the client can re-derive the key during recovery.
    keyBackupOpsLimit: key.keyBackupOpsLimit,
    keyBackupMemLimit: key.keyBackupMemLimit,
    keyBackupAlg: key.keyBackupAlg,
  };
}

export async function updateKeyBackUp({
  userId,
  encryptedPrivateKey,
  nonce,
  salt,
  opsLimit,
  alg,
  memLimit,
}: updateKeyBackUp) {
  // saves the key backup for the user
  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      keyBackupEncrypted: encryptedPrivateKey!,
      keyBackupNonce: nonce!,
      keyBackupSalt: salt!,
      keyBackupOpsLimit: typeof opsLimit === "number" ? opsLimit : null,
      keyBackupMemLimit: typeof memLimit === "number" ? memLimit : null,
      keyBackupAlg: typeof alg === "number" ? alg : null,
    },
  });

  return "Backup key saved";
}

export async function getOtherUser({
  targetedUserId,
}: {
  targetedUserId: number;
}) {
  // check if the targeted user exists or not
  const targetedUser = await prisma.user.findUnique({
    where: { id: targetedUserId },
    select: {
      id: true,
      username: true,
      avatar: true,
      created_at: true,
      lastSeen: true,
    },
  });

  if (!targetedUser) throw new AppError("User not found", 400);

  return targetedUser;
}
